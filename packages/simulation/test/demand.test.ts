import { describe, expect, it } from 'vitest';
import { calculateCityDemand, createSimulation } from '../src/index';

describe('spatial demand', () => {
  it('returns finite bounded values in stable row-major order', () => {
    const snapshot = createSimulation({ width: 6, height: 5, seed: 42 }).getSnapshot();
    expect(snapshot.demand.cells).toHaveLength(30);
    expect(snapshot.demand.cells.map((cell) => cell.position)).toEqual(
      Array.from({ length: 30 }, (_, index) => ({ x: index % 6, y: Math.floor(index / 6) })),
    );

    for (const cell of snapshot.demand.cells) {
      for (const value of [cell.living, cell.working, cell.services]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    for (const value of Object.values(snapshot.demand.totals)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('is reproducible for the same configuration', () => {
    const configuration = {
      width: 9,
      height: 7,
      seed: 9876,
      citizenCount: 12,
      housingCapacity: 8,
      workplaceCapacity: 10,
    } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    for (let tick = 0; tick < 75; tick += 1) {
      left.step();
      right.step();
    }
    expect(left.getSnapshot().demand).toEqual(right.getSnapshot().demand);
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
  });

  it('responds to capacity pressure', () => {
    const baseline = createSimulation({ citizenCount: 10 }).getSnapshot();
    const pressure = createSimulation({
      citizenCount: 10,
      housingCapacity: 4,
      workplaceCapacity: 4,
    }).getSnapshot();

    expect(pressure.demand.totals.living).toBeGreaterThan(baseline.demand.totals.living);
    expect(pressure.demand.totals.working).toBeGreaterThan(baseline.demand.totals.working);
    expect(pressure.metrics.space).toBeLessThan(baseline.metrics.space);
  });

  it('rejects non-finite future seed influence', () => {
    expect(() =>
      calculateCityDemand({
        width: 5,
        height: 5,
        buildings: [
          { id: 'home', type: 'home', position: { x: 2, y: 2 }, capacity: 1 },
          { id: 'work', type: 'workplace', position: { x: 2, y: 2 }, capacity: 1 },
        ],
        citizens: [{ homeBuildingId: 'home', workplaceBuildingId: 'work' }],
        metrics: { space: 1, access: 1, activity: 0 },
        seedInfluence: () => Number.NaN,
      }),
    ).toThrow(/finite/);
  });
});
