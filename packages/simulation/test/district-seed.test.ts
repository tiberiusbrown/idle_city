import { describe, expect, it } from 'vitest';
import {
  calculateDistrictSeedInfluence,
  createSimulation,
  DISTRICT_SEED_COSTS,
  type PlaceDistrictSeedCommand,
  type Simulation,
} from '../src/index';

function expectMutationFreeRejection(
  simulation: Simulation,
  command: PlaceDistrictSeedCommand,
  reason: string,
): void {
  const before = simulation.getSnapshot();
  const hashBefore = simulation.getDeterminismHash();
  expect(simulation.placeDistrictSeed(command)).toEqual({ accepted: false, reason });
  expect(simulation.getSnapshot()).toEqual(before);
  expect(simulation.getDeterminismHash()).toBe(hashBefore);
}

describe('authoritative district seed commands', () => {
  it('accepts a living seed and subtracts its cost exactly once', () => {
    const simulation = createSimulation({
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.living + 3,
    });
    const before = simulation.getSnapshot();

    expect(simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } })).toEqual({
      accepted: true,
      seed: {
        id: 'district-seed-1',
        kind: 'living',
        position: { x: 5, y: 1 },
      },
      cost: DISTRICT_SEED_COSTS.living,
    });

    const after = simulation.getSnapshot();
    expect(after.data).toBe(before.data - DISTRICT_SEED_COSTS.living);
    expect(after.seeds).toEqual([
      { id: 'district-seed-1', kind: 'living', position: { x: 5, y: 1 } },
    ]);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.citizens).toEqual(before.citizens);
    expect(after.randomState).toBe(before.randomState);
  });

  it('rejects inactive signed coordinates without mutating state', () => {
    const simulation = createSimulation({ startingData: 100 });
    expectMutationFreeRejection(
      simulation,
      { kind: 'living', position: { x: -1, y: 0 } },
      'inactive-chunk',
    );
  });

  it('rejects a duplicate seed cell without consuming Data or an ID', () => {
    const simulation = createSimulation({ startingData: 100 });
    const first = simulation.placeDistrictSeed({ kind: 'living', position: { x: 6, y: 6 } });
    expect(first.accepted).toBe(true);
    expectMutationFreeRejection(
      simulation,
      { kind: 'working', position: { x: 6, y: 6 } },
      'occupied',
    );

    expect(
      simulation.placeDistrictSeed({ kind: 'working', position: { x: 7, y: 6 } }),
    ).toMatchObject({ accepted: true, seed: { id: 'district-seed-2' } });
  });

  it('accepts a working seed and charges its centralized cost once', () => {
    const simulation = createSimulation({ startingData: DISTRICT_SEED_COSTS.working + 1 });
    const before = simulation.getSnapshot();
    expect(simulation.placeDistrictSeed({ kind: 'working', position: { x: 8, y: 8 } })).toEqual({
      accepted: true,
      seed: {
        id: 'district-seed-1',
        kind: 'working',
        position: { x: 8, y: 8 },
      },
      cost: DISTRICT_SEED_COSTS.working,
    });
    expect(simulation.getSnapshot().data).toBe(before.data - DISTRICT_SEED_COSTS.working);
  });

  it('previews the same authoritative validation without mutating state', () => {
    const simulation = createSimulation({ startingData: DISTRICT_SEED_COSTS.living });
    const before = simulation.getSnapshot();
    const hashBefore = simulation.getDeterminismHash();

    expect(simulation.previewDistrictSeed({ kind: 'living', position: { x: 6, y: 6 } })).toEqual({
      valid: true,
      cost: DISTRICT_SEED_COSTS.living,
    });
    expect(simulation.getSnapshot()).toEqual(before);
    expect(simulation.getDeterminismHash()).toBe(hashBefore);

    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 6, y: 6 } }).accepted,
    ).toBe(true);
    expect(simulation.previewDistrictSeed({ kind: 'working', position: { x: 6, y: 6 } })).toEqual({
      valid: false,
      reason: 'occupied',
    });
    expect(simulation.previewDistrictSeed({ kind: 'services', position: { x: 7, y: 6 } })).toEqual({
      valid: false,
      reason: 'locked',
    });
  });

  it('rejects insufficient Data and locked Services without changing state', () => {
    const simulation = createSimulation();
    expectMutationFreeRejection(
      simulation,
      { kind: 'living', position: { x: 6, y: 6 } },
      'insufficient-data',
    );
    const funded = createSimulation({ startingData: 100 });
    expectMutationFreeRejection(funded, { kind: 'services', position: { x: 6, y: 6 } }, 'locked');
  });

  it('keeps seed IDs and influence stable for the same accepted command sequence', () => {
    const configuration = { startingData: 100, seed: 17 } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    const commands: readonly PlaceDistrictSeedCommand[] = [
      { kind: 'living', position: { x: 5, y: 1 } },
      { kind: 'working', position: { x: 8, y: 7 } },
    ];

    for (const command of commands)
      expect(left.placeDistrictSeed(command)).toEqual(right.placeDistrictSeed(command));
    expect(left.getSnapshot().seeds.map((seed) => seed.id)).toEqual([
      'district-seed-1',
      'district-seed-2',
    ]);
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
  });

  it('preserves matching-kind district seed influence in bounded demand queries', () => {
    const baseline = createSimulation({ citizenCount: 1 }).getDemandChunk({ x: 0, y: 0 });
    const livingSimulation = createSimulation({
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    });
    const workingSimulation = createSimulation({
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.working,
    });
    expect(
      livingSimulation.placeDistrictSeed({ kind: 'living', position: { x: 0, y: 0 } }).accepted,
    ).toBe(true);
    expect(
      workingSimulation.placeDistrictSeed({ kind: 'working', position: { x: 0, y: 0 } }).accepted,
    ).toBe(true);
    const living = livingSimulation.getDemandChunk({ x: 0, y: 0 });
    const working = workingSimulation.getDemandChunk({ x: 0, y: 0 });
    if (baseline === undefined || living === undefined || working === undefined) {
      throw new Error('The initial demand chunk must be queryable.');
    }
    const baselineOrigin = baseline.cells[0];
    const livingOrigin = living.cells[0];
    const workingOrigin = working.cells[0];
    if (baselineOrigin === undefined || livingOrigin === undefined || workingOrigin === undefined) {
      throw new Error('The demand chunk must contain an origin cell.');
    }
    expect(livingOrigin.living).toBeGreaterThan(baselineOrigin.living);
    expect(livingOrigin.working).toBe(baselineOrigin.working);
    expect(workingOrigin.working).toBeGreaterThan(baselineOrigin.working);
    expect(workingOrigin.living).toBe(baselineOrigin.living);
  });

  it('rounds and caps the documented influence formula', () => {
    const seeds = [
      { id: 'district-seed-1', kind: 'living' as const, position: { x: 0, y: 0 } },
      { id: 'district-seed-2', kind: 'living' as const, position: { x: 4, y: 4 } },
    ];
    const firstSeed = seeds[0];
    if (firstSeed === undefined) throw new Error('The formula test requires a seed.');
    expect(
      calculateDistrictSeedInfluence({
        width: 5,
        height: 5,
        seeds,
        position: { x: 0, y: 0 },
        kind: 'living',
      }),
    ).toBe(1);
    expect(
      calculateDistrictSeedInfluence({
        width: 5,
        height: 5,
        seeds: [firstSeed],
        position: { x: 2, y: 0 },
        kind: 'living',
      }),
    ).toBe(0.6);
    expect(
      calculateDistrictSeedInfluence({
        width: 5,
        height: 5,
        seeds,
        position: { x: 2, y: 2 },
        kind: 'working',
      }),
    ).toBe(0);
  });
});
