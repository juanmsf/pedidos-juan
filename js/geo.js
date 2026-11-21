const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(lat1, lng1, lat2, lng2) {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = (lng2 - lng1) * DEG_TO_RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

export function shortestAngleDelta(fromDeg, toDeg) {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

export function smoothAngle(currentDeg, targetDeg, alpha = 0.28) {
  if (currentDeg == null || Number.isNaN(currentDeg)) return targetDeg;
  const delta = shortestAngleDelta(currentDeg, targetDeg);
  return (currentDeg + delta * alpha + 360) % 360;
}

export function distanceToSegmentMeters(pLat, pLng, aLat, aLng, bLat, bLng) {
  const refLatRad = pLat * DEG_TO_RAD;
  const mPerDegLat = 111132.92;
  const mPerDegLng = 111412.84 * Math.cos(refLatRad);

  const ax = (aLng - pLng) * mPerDegLng;
  const ay = (aLat - pLat) * mPerDegLat;
  const bx = (bLng - pLng) * mPerDegLng;
  const by = (bLat - pLat) * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-6) {
    return Math.hypot(ax, ay);
  }

  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(projX, projY);
}

/**
 * Computes minimum distance from (lat, lng) to a GeoJSON LineString coordinate array [[lng, lat], ...].
 * Also returns the nearest segment index and the forward bearing of that segment.
 */
export function distanceToPolylineMeters(lat, lng, coords) {
  if (!coords || coords.length < 2) {
    return { distance: Infinity, segmentIndex: 0, segmentBearing: null };
  }

  let minDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [aLng, aLat] = coords[i];
    const [bLng, bLat] = coords[i + 1];
    const d = distanceToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
    }
  }

  const [aLng, aLat] = coords[bestIdx];
  const [bLng, bLat] = coords[bestIdx + 1];
  const segmentBearing = bearingDegrees(aLat, aLng, bLat, bLng);

  return { distance: minDist, segmentIndex: bestIdx, segmentBearing };
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) {
    const rounded = meters < 50 ? Math.round(meters / 5) * 5 : Math.round(meters / 10) * 10;
    return `${rounded} m`;
  }
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}
