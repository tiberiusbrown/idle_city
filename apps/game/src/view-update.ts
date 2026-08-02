import type { SimulationSnapshot } from '@idle-city/simulation';

export function updateSimulationView(
  snapshot: SimulationSnapshot,
  interpolation: number,
  reconcile: (snapshot: SimulationSnapshot, interpolation: number) => void,
  renderHud: (snapshot: SimulationSnapshot) => void,
): void {
  reconcile(snapshot, interpolation);
  renderHud(snapshot);
}
