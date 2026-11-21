import {
  haversineMeters,
  bearingDegrees,
  shortestAngleDelta,
  smoothAngle,
  formatDistance,
  formatDuration,
} from './js/geo.js';
import { speech } from './js/speech.js';
import { NavigationController, searchPlaces } from './js/navigation.js';
import { DriveSimulator } from './js/simulator.js';

const VECTOR_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

const RASTER_FALLBACK_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-brightness-max': 0.72,
        'raster-saturation': -0.25,
      },
    },
  ],
};

// DOM elements
const appEl = document.getElementById('app');
const maneuverIconEl = document.getElementById('maneuver-icon');
const hudDistanceEl = document.getElementById('hud-distance');
const hudStreetEl = document.getElementById('hud-street');
const hudStatusBadgeEl = document.getElementById('hud-status-badge');
const hudSpeedEl = document.getElementById('hud-speed');
const routeTelemetryEl = document.getElementById('route-telemetry');
const hudEtaEl = document.getElementById('hud-eta');
const hudRemDistEl = document.getElementById('hud-rem-dist');

const btnRecenter = document.getElementById('btn-recenter');
const btnVoice = document.getElementById('btn-voice');
const iconVoiceOn = document.getElementById('icon-voice-on');
const iconVoiceOff = document.getElementById('icon-voice-off');
const btnHudOpacity = document.getElementById('btn-hud-opacity');
const btnDemo = document.getElementById('btn-demo');
const btnSearchToggle = document.getElementById('btn-search-toggle');
const btnSearchClose = document.getElementById('btn-search-close');
const btnCancelRoute = document.getElementById('btn-cancel-route');

const searchDrawer = document.getElementById('search-drawer');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');

// State
let followHeadingUp = true;
let smoothedHeading = 0;
let currentPos = null; // { lat, lng, speedMs }
let lastBearingFix = null; // { lat, lng }
let watchId = null;
let fallbackApplied = false;

// Initialize MapLibre GL JS
const map = new maplibregl.Map({
  container: 'map',
  style: VECTOR_STYLE_URL,
  center: [-58.3816, -34.6037], // Default: Buenos Aires Obelisco until GPS locks
  zoom: 16.8,
  pitch: 48,
  bearing: 0,
  attributionControl: true,
});

map.on('error', (e) => {
  if (!fallbackApplied && e?.error && String(e.error.message || '').includes('Failed to fetch')) {
    fallbackApplied = true;
    map.setStyle(RASTER_FALLBACK_STYLE);
  }
});

// Vehicle Puck Marker (always points UP when Heading-Up is locked)
const puckEl = document.createElement('div');
puckEl.className = 'vehicle-puck';
puckEl.innerHTML = `
  <div class="vehicle-puck-ring"></div>
  <svg class="vehicle-puck-arrow" viewBox="0 0 24 24" fill="none">
    <path d="M12 2L20 20L12 16.2L4 20L12 2Z" fill="#38bdf8" stroke="#082f49" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>
`;
const puckArrowEl = puckEl.querySelector('.vehicle-puck-arrow');

const vehicleMarker = new maplibregl.Marker({
  element: puckEl,
  anchor: 'center',
})
  .setLngLat([-58.3816, -34.6037])
  .addTo(map);

let destMarker = null;

function ensureRouteLayers() {
  if (!map.isStyleLoaded()) return;

  if (!map.getSource('nav-route')) {
    map.addSource('nav-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: 'nav-route-casing',
      type: 'line',
      source: 'nav-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#0369a1',
        'line-width': 10,
        'line-opacity': 0.75,
      },
    });

    map.addLayer({
      id: 'nav-route-line',
      type: 'line',
      source: 'nav-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#38bdf8',
        'line-width': 5.5,
        'line-opacity': 0.95,
      },
    });
  }
}

map.on('style.load', () => {
  ensureRouteLayers();
  if (nav.route) {
    renderRouteOnMap(nav.route);
  }
});

function renderRouteOnMap(route) {
  ensureRouteLayers();
  const src = map.getSource('nav-route');
  if (!src) return;

  if (!route) {
    src.setData({ type: 'FeatureCollection', features: [] });
    if (destMarker) {
      destMarker.remove();
      destMarker = null;
    }
    routeTelemetryEl.classList.add('hidden');
    maneuverIconEl.textContent = '↑';
    hudDistanceEl.textContent = 'En marcha';
    return;
  }

  src.setData({
    type: 'Feature',
    geometry: route.geometry,
  });
  routeTelemetryEl.classList.remove('hidden');
}

function setStatusBadge(text) {
  if (!text) {
    hudStatusBadgeEl.textContent = '';
    hudStatusBadgeEl.classList.add('hidden');
  } else {
    hudStatusBadgeEl.textContent = text;
    hudStatusBadgeEl.classList.remove('hidden');
  }
}

// Navigation Controller
const nav = new NavigationController({
  onRouteUpdate: (route) => {
    renderRouteOnMap(route);
    setStatusBadge('');
  },
  onStreetChange: (streetName) => {
    if (!nav.route) {
      hudStreetEl.textContent = streetName;
    }
  },
  onStepUpdate: ({ distToNext, remainingDist, remainingDur, instruction, icon }) => {
    maneuverIconEl.textContent = icon;
    hudDistanceEl.textContent = formatDistance(distToNext);
    hudStreetEl.textContent = instruction;
    hudEtaEl.textContent = formatDuration(remainingDur);
    hudRemDistEl.textContent = formatDistance(remainingDist);
  },
  onArrive: () => {
    setStatusBadge('Destino');
    setTimeout(() => nav.clearRoute(), 4000);
  },
  onStatus: (msg) => setStatusBadge(msg),
});

// Detect manual map pan/rotate -> unlock Heading-Up temporarily
function unlockFollowOnUserGesture(e) {
  if (e && e.originalEvent && followHeadingUp) {
    followHeadingUp = false;
    btnRecenter.classList.remove('active');
  }
}
map.on('dragstart', unlockFollowOnUserGesture);
map.on('rotatestart', unlockFollowOnUserGesture);

map.on('rotate', () => {
  if (!followHeadingUp) {
    const relAngle = (smoothedHeading - map.getBearing() + 360) % 360;
    puckArrowEl.style.transform = `rotate(${relAngle}deg)`;
  }
});

// Handle incoming GPS or Simulated position
async function handlePosition(pos) {
  const { latitude: lat, longitude: lng, heading, speed, accuracy } = pos.coords;

  // Ignore very coarse fixes once we already have a position
  if (currentPos && Number.isFinite(accuracy) && accuracy > 75) {
    return;
  }

  const speedMs = Number.isFinite(speed) && speed >= 0 ? speed : 0;
  currentPos = { lat, lng, speedMs };

  // Update speed display
  const kmh = Math.round(speedMs * 3.6);
  hudSpeedEl.textContent = String(kmh);

  // Compute reliable travel heading
  let targetHeading = null;
  const isMoving = speedMs >= 1.1;

  if (isMoving && Number.isFinite(heading)) {
    targetHeading = heading;
  } else if (lastBearingFix) {
    const distMoved = haversineMeters(lastBearingFix.lat, lastBearingFix.lng, lat, lng);
    if (distMoved >= 4.5) {
      targetHeading = bearingDegrees(lastBearingFix.lat, lastBearingFix.lng, lat, lng);
      lastBearingFix = { lat, lng };
    }
  } else {
    lastBearingFix = { lat, lng };
  }

  // Update navigation & check if on-route for street-aligned bearing assist
  const { onRoute, segmentBearing } = await nav.updatePosition(lat, lng, speedMs);

  if (targetHeading != null) {
    // If actively on route and heading roughly matches street direction, gently align to street
    if (onRoute && segmentBearing != null && Math.abs(shortestAngleDelta(targetHeading, segmentBearing)) < 35) {
      targetHeading = smoothAngle(targetHeading, segmentBearing, 0.45);
    }
    smoothedHeading = smoothAngle(smoothedHeading, targetHeading, 0.34);
  }

  // Move vehicle marker
  vehicleMarker.setLngLat([lng, lat]);

  // Camera follow in vertical Heading-Up orientation
  if (followHeadingUp) {
    puckArrowEl.style.transform = 'rotate(0deg)';
    const topPad = Math.round(window.innerHeight * 0.35);
    map.easeTo({
      center: [lng, lat],
      bearing: smoothedHeading,
      pitch: 48,
      zoom: kmh > 65 ? 15.8 : 17.0,
      padding: { top: topPad, bottom: 24, left: 0, right: 0 },
      duration: 240,
      easing: (t) => t,
    });
  } else {
    const relAngle = (smoothedHeading - map.getBearing() + 360) % 360;
    puckArrowEl.style.transform = `rotate(${relAngle}deg)`;
  }
}

// Start real browser Geolocation
function startGeolocation() {
  if (!('geolocation' in navigator)) {
    hudStreetEl.textContent = 'GPS no disponible — usá Simular (▶)';
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!simulator.running) {
        handlePosition(pos);
      }
    },
    (err) => {
      if (!simulator.running && !currentPos) {
        hudStreetEl.textContent =
          err.code === 1
            ? 'Permiso GPS denegado — usá Simular (▶)'
            : 'Esperando señal GPS...';
      }
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    }
  );
}

// Simulator for instant testing
const simulator = new DriveSimulator((pos) => handlePosition(pos));

// UI Event Listeners
btnRecenter.addEventListener('click', () => {
  speech.unlock();
  followHeadingUp = true;
  btnRecenter.classList.add('active');
  puckArrowEl.style.transform = 'rotate(0deg)';

  if (currentPos) {
    map.easeTo({
      center: [currentPos.lng, currentPos.lat],
      bearing: smoothedHeading,
      pitch: 48,
      padding: { top: Math.round(window.innerHeight * 0.35), bottom: 24, left: 0, right: 0 },
      duration: 380,
    });
  }
});

btnVoice.addEventListener('click', () => {
  speech.unlock();
  const nextMuted = !speech.muted;
  speech.setMuted(nextMuted);
  btnVoice.classList.toggle('active', !nextMuted);
  iconVoiceOn.classList.toggle('hidden', nextMuted);
  iconVoiceOff.classList.toggle('hidden', !nextMuted);
});

btnHudOpacity.addEventListener('click', () => {
  const isGhost = appEl.classList.toggle('hud-ghost');
  btnHudOpacity.classList.toggle('active', isGhost);
});

btnDemo.addEventListener('click', () => {
  speech.unlock();
  if (simulator.running) {
    simulator.stop();
    btnDemo.classList.remove('active');
    setStatusBadge('');
  } else {
    followHeadingUp = true;
    btnRecenter.classList.add('active');
    simulator.start();
    btnDemo.classList.add('active');
    setStatusBadge('Demo');
  }
});

btnSearchToggle.addEventListener('click', () => {
  speech.unlock();
  searchDrawer.classList.remove('hidden');
  searchInput.focus();
});

btnSearchClose.addEventListener('click', () => {
  searchDrawer.classList.add('hidden');
});

btnCancelRoute.addEventListener('click', () => {
  nav.clearRoute();
  setStatusBadge('');
});

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;

  searchResultsEl.innerHTML = '<li class="search-result-item"><div class="search-result-title">Buscando...</div></li>';
  try {
    const results = await searchPlaces(q, currentPos?.lat, currentPos?.lng);
    if (!results.length) {
      searchResultsEl.innerHTML = '<li class="search-result-item"><div class="search-result-title">Sin resultados</div></li>';
      return;
    }

    searchResultsEl.innerHTML = '';
    for (const place of results) {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      li.innerHTML = `
        <div class="search-result-title"></div>
        <div class="search-result-sub"></div>
      `;
      li.querySelector('.search-result-title').textContent = place.shortName;
      li.querySelector('.search-result-sub').textContent = place.name;

      li.addEventListener('click', async () => {
        searchDrawer.classList.add('hidden');
        searchResultsEl.innerHTML = '';
        followHeadingUp = true;
        btnRecenter.classList.add('active');

        if (!currentPos) {
          // If GPS hasn't locked yet, start simulator or use map center
          const center = map.getCenter();
          currentPos = { lat: center.lat, lng: center.lng, speedMs: 0 };
        }

        if (destMarker) destMarker.remove();
        destMarker = new maplibregl.Marker({ color: '#38bdf8' })
          .setLngLat([place.lng, place.lat])
          .addTo(map);

        try {
          await nav.setDestination(place, currentPos.lat, currentPos.lng);
        } catch (err) {
          setStatusBadge(err.message || 'Error de ruta');
        }
      });

      searchResultsEl.appendChild(li);
    }
  } catch {
    searchResultsEl.innerHTML = '<li class="search-result-item"><div class="search-result-title">Error de conexión</div></li>';
  }
});

// Start GPS tracking on load
startGeolocation();
