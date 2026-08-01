import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/index';

describe('small-city integration', () => {
  it('runs for thousands of ticks while preserving invariants and determinism', () => {
    const run = (): string => {
      const simulation = createSimulation({ width: 16, height: 12, seed: 456, citizenCount: 20 });
      for (let tick = 0; tick < 5_000; tick += 1) {
        simulation.step();
        if (tick % 97 !== 0) continue;
        const snapshot = simulation.getSnapshot();
        const buildingIds = new Set(snapshot.buildings.map((building) => building.id));
        for (const citizen of snapshot.citizens) {
          expect(citizen.position.x).toBeGreaterThanOrEqual(0);
          expect(citizen.position.y).toBeGreaterThanOrEqual(0);
          expect(citizen.position.x).toBeLessThan(snapshot.width);
          expect(citizen.position.y).toBeLessThan(snapshot.height);
          expect(buildingIds.has(citizen.homeBuildingId)).toBe(true);
          expect(buildingIds.has(citizen.workplaceBuildingId)).toBe(true);
          for (let index = 1; index < citizen.route.length; index += 1) {
            const previous = citizen.route[index - 1];
            const current = citizen.route[index];
            if (previous === undefined || current === undefined) {
              throw new Error('Route indexes must resolve during invariant checks.');
            }
            expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
          }
        }
      }
      return simulation.getDeterminismHash();
    };
    expect(run()).toBe(run());
  });
});
