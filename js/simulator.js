import { bearingDegrees, haversineMeters } from './geo.js';

// Real street waypoints in Buenos Aires: Av. 9 de Julio -> Av. Corrientes -> Av. Callao -> Av. Santa Fe
const DEMO_WAYPOINTS = [
  [-34.6085, -58.3816], // 9 de Julio & Moreno
  [-34.6062, -58.3816], // 9 de Julio & Rivadavia
  [-34.6037, -58.3816], // Obelisco (9 de Julio & Corrientes)
  [-34.6038, -58.3848], // Corrientes & Libertad
  [-34.6039, -58.3886], // Corrientes & Uruguay
  [-34.6041, -58.3924], // Corrientes & Callao
  [-34.6012, -58.3924], // Callao & Sarmiento
  [-34.5982, -58.3924], // Callao & Córdoba
  [-34.5955, -58.3924], // Callao & Santa Fe
  [-34.5951, -58.3965], // Santa Fe & Rodríguez Peña
  [-34.5946, -58.4012], // Santa Fe & Pueyrredón
];

export class DriveSimulator {
  constructor(onPosition) {
    this.onPosition = onPosition;
    this.timer = null;
    this.running = false;
    this.segIndex = 0;
    this.progress = 0;
    this.speedMs = 13.5; // ~48 km/h
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.segIndex = 0;
    this.progress = 0;

    const tickMs = 250;
    this.timer = setInterval(() => {
      if (!this.running) return;

      const a = DEMO_WAYPOINTS[this.segIndex];
      const b = DEMO_WAYPOINTS[this.segIndex + 1];
      if (!a || !b) {
        this.segIndex = 0;
        this.progress = 0;
        return;
      }

      const segDist = Math.max(haversineMeters(a[0], a[1], b[0], b[1]), 1);
      const stepDist = this.speedMs * (tickMs / 1000);
      this.progress += stepDist / segDist;

      while (this.progress >= 1 && this.segIndex < DEMO_WAYPOINTS.length - 2) {
        this.progress -= 1;
        this.segIndex += 1;
      }
      if (this.progress >= 1 && this.segIndex >= DEMO_WAYPOINTS.length - 2) {
        this.segIndex = 0;
        this.progress = 0;
      }

      const pA = DEMO_WAYPOINTS[this.segIndex];
      const pB = DEMO_WAYPOINTS[this.segIndex + 1];
      const lat = pA[0] + (pB[0] - pA[0]) * this.progress;
      const lng = pA[1] + (pB[1] - pA[1]) * this.progress;
      const heading = bearingDegrees(pA[0], pA[1], pB[0], pB[1]);

      this.onPosition({
        coords: {
          latitude: lat,
          longitude: lng,
          heading,
          speed: this.speedMs,
          accuracy: 5,
        },
        timestamp: Date.now(),
        isSimulated: true,
      });
    }, tickMs);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
