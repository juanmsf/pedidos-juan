import {
  haversineMeters,
  distanceToPolylineMeters,
  formatDistance,
} from './geo.js';
import { speech } from './speech.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const OSRM_BASE = 'https://router.project-osrm.org';

const OFF_ROUTE_THRESHOLD_M = 50;
const OFF_ROUTE_STREAK_REQUIRED = 3;
const OFF_ROUTE_MIN_MS = 5000;
const RECALC_COOLDOWN_MS = 25000;

export async function searchPlaces(query, nearLat = null, nearLng = null) {
  const q = query.trim();
  if (!q) return [];

  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    'accept-language': 'es',
  });

  if (nearLat != null && nearLng != null) {
    const d = 0.35;
    params.set('viewbox', `${nearLng - d},${nearLat + d},${nearLng + d},${nearLat - d}`);
  }

  const res = await fetch(`${NOMINATIM_BASE}/search?${params.toString()}`);
  if (!res.ok) throw new Error('Error buscando destino');
  const data = await res.json();

  return data.map((item) => {
    const parts = (item.display_name || '').split(',').map((s) => s.trim());
    return {
      name: item.display_name,
      shortName: parts.slice(0, 2).join(', ') || item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    };
  });
}

export async function reverseGeocodeStreet(lat, lng) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    zoom: '17',
    'accept-language': 'es',
  });

  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  const addr = data.address || {};
  return (
    addr.road ||
    addr.pedestrian ||
    addr.avenue ||
    addr.footway ||
    addr.neighbourhood ||
    addr.suburb ||
    null
  );
}

export async function fetchRoute(fromLat, fromLng, toLat, toLng) {
  const url = `${OSRM_BASE}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo calcular la ruta');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
    throw new Error('No se encontró una ruta válida');
  }
  const route = data.routes[0];
  const steps = route.legs.flatMap((leg) => leg.steps || []);
  return {
    geometry: route.geometry,
    distance: route.distance,
    duration: route.duration,
    steps,
  };
}

export function getManeuverIcon(step) {
  if (!step || !step.maneuver) return '↑';
  const { type, modifier } = step.maneuver;
  if (type === 'arrive') return '★';
  if (type === 'roundabout' || type === 'rotary') return '↻';
  if (modifier === 'left' || modifier === 'sharp left') return '↰';
  if (modifier === 'slight left') return '↖';
  if (modifier === 'right' || modifier === 'sharp right') return '↱';
  if (modifier === 'slight right') return '↗';
  if (modifier === 'uturn') return '↺';
  return '↑';
}

export function formatManeuverSpanish(step) {
  if (!step || !step.maneuver) return 'Continuá recto';
  const { type, modifier, exit } = step.maneuver;
  const street = step.name ? ` por ${step.name}` : '';
  const ontoStreet = step.name ? ` en ${step.name}` : '';

  if (type === 'arrive') return 'Llegaste a tu destino';
  if (type === 'depart') return `Iniciá el recorrido${street}`;
  if (type === 'roundabout' || type === 'rotary') {
    const exitTxt = exit ? `tomá la salida ${exit}` : 'seguí';
    return `En la rotonda, ${exitTxt}${ontoStreet}`;
  }

  const modMap = {
    left: 'Girá a la izquierda',
    'sharp left': 'Girá cerrado a la izquierda',
    'slight left': 'Mantenete a la izquierda',
    right: 'Girá a la derecha',
    'sharp right': 'Girá cerrado a la derecha',
    'slight right': 'Mantenete a la derecha',
    uturn: 'Hacé un giro en U',
    straight: 'Continuá recto',
  };

  if (type === 'merge') return `Incorporáte${ontoStreet}`;
  if (type === 'fork') {
    return `${modMap[modifier] || 'Mantenete'}${ontoStreet}`;
  }

  const action = modMap[modifier] || 'Continuá';
  return `${action}${ontoStreet}`;
}

export class NavigationController {
  constructor({ onRouteUpdate, onStreetChange, onStepUpdate, onArrive, onStatus }) {
    this.onRouteUpdate = onRouteUpdate;
    this.onStreetChange = onStreetChange;
    this.onStepUpdate = onStepUpdate;
    this.onArrive = onArrive;
    this.onStatus = onStatus;

    this.destination = null;
    this.route = null;
    this.currentStepIndex = 0;

    // Anti-loop recalculation state
    this.offRouteStreak = 0;
    this.offRouteSince = 0;
    this.isRecalculating = false;
    this.lastRecalcAt = 0;

    // Spoken deduplication
    this.spokenStepThresholds = new Set();
    this.lastSpokenStreet = '';

    // Free-drive reverse geocode throttling
    this.lastReverseAt = 0;
    this.lastReverseLat = null;
    this.lastReverseLng = null;
    this.isReversing = false;
  }

  async setDestination(dest, currentLat, currentLng) {
    this.destination = dest;
    this.resetRecalcState();
    this.spokenStepThresholds.clear();

    if (currentLat == null || currentLng == null) {
      throw new Error('Esperando señal GPS para calcular la ruta');
    }

    this.onStatus?.('Calculando ruta...');
    const route = await fetchRoute(currentLat, currentLng, dest.lat, dest.lng);
    this.route = route;
    this.currentStepIndex = 0;
    this.onRouteUpdate?.(route);

    const firstStep = route.steps[1] || route.steps[0];
    if (firstStep) {
      const msg = formatManeuverSpanish(firstStep);
      speech.speak(`Ruta lista. ${msg}`, { key: 'route-start', minCooldownMs: 5000, priority: 'high' });
    }
    return route;
  }

  clearRoute() {
    this.destination = null;
    this.route = null;
    this.currentStepIndex = 0;
    this.resetRecalcState();
    this.spokenStepThresholds.clear();
    this.onRouteUpdate?.(null);
  }

  resetRecalcState() {
    this.offRouteStreak = 0;
    this.offRouteSince = 0;
    this.isRecalculating = false;
  }

  async updatePosition(lat, lng, speedMs = 0) {
    if (!this.route || !this.destination) {
      await this._updateFreeDriveStreet(lat, lng, speedMs);
      return { onRoute: null, segmentBearing: null };
    }

    const coords = this.route.geometry.coordinates;
    const { distance: distToRoute, segmentBearing } = distanceToPolylineMeters(lat, lng, coords);

    // Check arrival (< 35m from destination)
    const distToDest = haversineMeters(lat, lng, this.destination.lat, this.destination.lng);
    if (distToDest < 35) {
      speech.speak('Llegaste a tu destino', { key: 'arrive', minCooldownMs: 60000, priority: 'high' });
      this.onArrive?.();
      return { onRoute: true, segmentBearing };
    }

    // Strict Anti-Loop Off-Route Detection
    const now = Date.now();
    if (distToRoute > OFF_ROUTE_THRESHOLD_M) {
      if (this.offRouteStreak === 0) this.offRouteSince = now;
      this.offRouteStreak += 1;

      const offDuration = now - this.offRouteSince;
      const cooldownElapsed = now - this.lastRecalcAt >= RECALC_COOLDOWN_MS;

      if (
        !this.isRecalculating &&
        this.offRouteStreak >= OFF_ROUTE_STREAK_REQUIRED &&
        offDuration >= OFF_ROUTE_MIN_MS &&
        cooldownElapsed
      ) {
        this._triggerRecalculate(lat, lng);
      }
      return { onRoute: false, segmentBearing: null };
    }

    // Back on route -> reset streak immediately
    this.offRouteStreak = 0;
    this.offRouteSince = 0;

    // Advance step index based on proximity to next maneuver
    this._advanceSteps(lat, lng);

    // Compute remaining distance & duration
    const steps = this.route.steps;
    const currentStep = steps[this.currentStepIndex] || steps[0];
    const nextStep = steps[this.currentStepIndex + 1] || currentStep;

    const [mLng, mLat] = nextStep.maneuver.location;
    const distToNext = haversineMeters(lat, lng, mLat, mLng);

    let remainingDist = distToNext;
    let remainingDur = (distToNext / Math.max(nextStep.distance || 1, 1)) * (nextStep.duration || 0);
    for (let i = this.currentStepIndex + 1; i < steps.length; i++) {
      remainingDist += steps[i].distance || 0;
      remainingDur += steps[i].duration || 0;
    }

    const activeStreet = currentStep?.name || '';
    if (activeStreet) {
      this.onStreetChange?.(activeStreet);
      this._announceStreetIfChanged(activeStreet);
    }

    this._announceUpcomingManeuver(nextStep, this.currentStepIndex + 1, distToNext);

    this.onStepUpdate?.({
      currentStep,
      nextStep,
      distToNext,
      remainingDist,
      remainingDur,
      instruction: formatManeuverSpanish(nextStep),
      icon: getManeuverIcon(nextStep),
    });

    return { onRoute: true, segmentBearing };
  }

  _advanceSteps(lat, lng) {
    const steps = this.route.steps;
    while (this.currentStepIndex < steps.length - 2) {
      const nextStep = steps[this.currentStepIndex + 1];
      const [mLng, mLat] = nextStep.maneuver.location;
      const d = haversineMeters(lat, lng, mLat, mLng);
      if (d < 28) {
        this.currentStepIndex += 1;
      } else {
        break;
      }
    }
  }

  _announceUpcomingManeuver(step, stepIdx, distMeters) {
    if (!step) return;
    const instruction = formatManeuverSpanish(step);

    const key250 = `step-${stepIdx}-250`;
    const key60 = `step-${stepIdx}-60`;

    if (distMeters <= 70 && !this.spokenStepThresholds.has(key60)) {
      this.spokenStepThresholds.add(key60);
      this.spokenStepThresholds.add(key250);
      speech.speak(instruction, { key: key60, minCooldownMs: 20000, priority: 'high' });
    } else if (distMeters <= 260 && distMeters > 90 && !this.spokenStepThresholds.has(key250)) {
      this.spokenStepThresholds.add(key250);
      speech.speak(`En ${formatDistance(distMeters)}, ${instruction.toLowerCase()}`, {
        key: key250,
        minCooldownMs: 20000,
      });
    }
  }

  _announceStreetIfChanged(streetName) {
    const clean = streetName.trim();
    if (!clean || clean === this.lastSpokenStreet) return;
    this.lastSpokenStreet = clean;
    speech.speak(`Por ${clean}`, {
      key: `street-${clean.toLowerCase()}`,
      minCooldownMs: 25000,
    });
  }

  async _updateFreeDriveStreet(lat, lng, speedMs) {
    const now = Date.now();
    if (this.isReversing) return;
    if (now - this.lastReverseAt < 10000) return;

    if (this.lastReverseLat != null) {
      const moved = haversineMeters(this.lastReverseLat, this.lastReverseLng, lat, lng);
      if (moved < 55) return;
    }

    this.isReversing = true;
    this.lastReverseAt = now;
    this.lastReverseLat = lat;
    this.lastReverseLng = lng;

    try {
      const street = await reverseGeocodeStreet(lat, lng);
      if (street) {
        this.onStreetChange?.(street);
        if (speedMs >= 1.0 || this.lastSpokenStreet === '') {
          this._announceStreetIfChanged(street);
        }
      }
    } catch {
      // Silent fail on network hiccup
    } finally {
      this.isReversing = false;
    }
  }

  async _triggerRecalculate(lat, lng) {
    this.isRecalculating = true;
    this.lastRecalcAt = Date.now();
    this.offRouteStreak = 0;
    this.offRouteSince = 0;

    this.onStatus?.('Recalculando ruta...');
    // Spoken at most once per 30s — guaranteed no loop
    speech.speak('Recalculando ruta', { key: 'recalc-voice', minCooldownMs: 30000 });

    try {
      const route = await fetchRoute(lat, lng, this.destination.lat, this.destination.lng);
      this.route = route;
      this.currentStepIndex = 0;
      this.spokenStepThresholds.clear();
      this.onRouteUpdate?.(route);
      this.onStatus?.('');
    } catch {
      this.onStatus?.('Sin conexión para recalcular');
    } finally {
      this.isRecalculating = false;
    }
  }
}
