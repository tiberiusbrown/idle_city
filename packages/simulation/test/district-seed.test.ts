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
      width: 5,
      height: 5,
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.living + 3,
    });
    const before = simulation.getSnapshot();

    expect(simulation.placeDistrictSeed({ kind: 'living', position: { x: 1, y: 1 } })).toEqual({
      accepted: true,
      seed: {
        id: 'district-seed-1',
        kind: 'living',
        position: { x: 1, y: 1 },
      },
      cost: DISTRICT_SEED_COSTS.living,
    });

    const after = simulation.getSnapshot();
    expect(after.data).toBe(before.data - DISTRICT_SEED_COSTS.living);
    expect(after.seeds).toEqual([
      { id: 'district-seed-1', kind: 'living', position: { x: 1, y: 1 } },
    ]);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.citizens).toEqual(before.citizens);
    expect(after.randomState).toBe(before.randomState);
  });

  it('rejects an out-of-bounds position without mutating state', () => {
    const simulation = createSimulation({ startingData: 100 });
    expectMutationFreeRejection(
      simulation,
      { kind: 'living', position: { x: -1, y: 0 } },
      'out-of-bounds',
    );
  });

  it('rejects a duplicate seed cell without consuming Data or an ID', () => {
    const simulation = createSimulation({ startingData: 100 });
    const first = simulation.placeDistrictSeed({ kind: 'living', position: { x: 3, y: 3 } });
    expect(first.accepted).toBe(true);
    expectMutationFreeRejection(
      simulation,
      { kind: 'working', position: { x: 3, y: 3 } },
      'occupied',
    );

    expect(
      simulation.placeDistrictSeed({ kind: 'working', position: { x: 4, y: 3 } }),
    ).toMatchObject({ accepted: true, seed: { id: 'district-seed-2' } });
  });

  it('accepts a working seed and charges its centralized cost once', () => {
    const simulation = createSimulation({ startingData: DISTRICT_SEED_COSTS.working + 1 });
    const before = simulation.getSnapshot();

    expect(simulation.placeDistrictSeed({ kind: 'working', position: { x: 4, y: 4 } })).toEqual({
      accepted: true,
      seed: {
        id: 'district-seed-1',
        kind: 'working',
        position: { x: 4, y: 4 },
      },
      cost: DISTRICT_SEED_COSTS.working,
    });
    expect(simulation.getSnapshot().data).toBe(before.data - DISTRICT_SEED_COSTS.working);
  });

  it('rejects insufficient Data without changing the random state', () => {
    const simulation = createSimulation();
    expectMutationFreeRejection(
      simulation,
      { kind: 'living', position: { x: 3, y: 3 } },
      'insufficient-data',
    );
  });

  it('keeps Services locked until service activities exist', () => {
    const simulation = createSimulation({ startingData: 100 });
    expectMutationFreeRejection(
      simulation,
      { kind: 'services', position: { x: 3, y: 3 } },
      'locked',
    );
  });

  it('keeps seed IDs stable for the same accepted command sequence', () => {
    const configuration = { startingData: 100, seed: 17 } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    const commands: readonly PlaceDistrictSeedCommand[] = [
      { kind: 'living', position: { x: 1, y: 1 } },
      { kind: 'working', position: { x: 8, y: 7 } },
    ];

    for (const command of commands) {
      expect(left.placeDistrictSeed(command)).toEqual(right.placeDistrictSeed(command));
    }
    expect(left.getSnapshot().seeds.map((seed) => seed.id)).toEqual([
      'district-seed-1',
      'district-seed-2',
    ]);
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
  });

  it('adds living and working influence using bounded deterministic distance', () => {
    const baseline = createSimulation({ width: 5, height: 5, citizenCount: 1 }).getSnapshot();
    const livingSimulation = createSimulation({
      width: 5,
      height: 5,
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    });
    const workingSimulation = createSimulation({
      width: 5,
      height: 5,
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.working,
    });
    expect(
      livingSimulation.placeDistrictSeed({ kind: 'living', position: { x: 0, y: 0 } }).accepted,
    ).toBe(true);
    expect(
      workingSimulation.placeDistrictSeed({ kind: 'working', position: { x: 0, y: 0 } }).accepted,
    ).toBe(true);

    const living = livingSimulation.getSnapshot();
    const working = workingSimulation.getSnapshot();
    const baselineOrigin = baseline.demand.cells[0];
    const baselineFar = baseline.demand.cells[24];
    const livingOrigin = living.demand.cells[0];
    const livingFar = living.demand.cells[24];
    const workingOrigin = working.demand.cells[0];
    const workingFar = working.demand.cells[24];
    if (
      baselineOrigin === undefined ||
      baselineFar === undefined ||
      livingOrigin === undefined ||
      livingFar === undefined ||
      workingOrigin === undefined ||
      workingFar === undefined
    ) {
      throw new Error('The 5 by 5 demand grid must contain every expected cell.');
    }
    expect(livingOrigin.living).toBeGreaterThan(baselineOrigin.living);
    expect(livingOrigin.working).toBe(baselineOrigin.working);
    expect(livingFar.living).toBe(baselineFar.living);
    expect(workingOrigin.working).toBeGreaterThan(baselineOrigin.working);
    expect(workingOrigin.living).toBe(baselineOrigin.living);
    expect(workingFar.working).toBe(baselineFar.working);
  });

  it('replays commands at the same ticks with identical snapshots and hashes', () => {
    const configuration = {
      width: 7,
      height: 6,
      seed: 99,
      citizenCount: 2,
      startingData: DISTRICT_SEED_COSTS.living + DISTRICT_SEED_COSTS.working,
    } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    const schedule = new Map<number, PlaceDistrictSeedCommand>([
      [0, { kind: 'living', position: { x: 1, y: 1 } }],
      [4, { kind: 'working', position: { x: 5, y: 4 } }],
      [9, { kind: 'living', position: { x: 1, y: 1 } }],
    ]);

    for (let tick = 0; tick < 20; tick += 1) {
      const command = schedule.get(tick);
      if (command !== undefined) {
        expect(left.placeDistrictSeed(command)).toEqual(right.placeDistrictSeed(command));
      }
      left.step();
      right.step();
      expect(left.getSnapshot()).toEqual(right.getSnapshot());
      expect(JSON.stringify(left.getSnapshot())).toBe(JSON.stringify(right.getSnapshot()));
      expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
    }
  });

  it('does not let a mutated snapshot seed alter authoritative seed state', () => {
    const simulation = createSimulation({ startingData: DISTRICT_SEED_COSTS.living });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 3, y: 3 } }).accepted,
    ).toBe(true);
    const snapshot = simulation.getSnapshot();
    const seed = snapshot.seeds[0];
    if (seed === undefined) throw new Error('The accepted seed must be present in the snapshot.');
    (seed.position as { x: number }).x = 0;
    (seed as { kind: 'working' }).kind = 'working';

    expect(simulation.getSnapshot().seeds).toEqual([
      { id: 'district-seed-1', kind: 'living', position: { x: 3, y: 3 } },
    ]);
    expect(simulation.placeDistrictSeed({ kind: 'working', position: { x: 3, y: 3 } })).toEqual({
      accepted: false,
      reason: 'occupied',
    });
  });

  it('rounds and caps the documented influence formula', () => {
    const seeds = [
      { id: 'district-seed-1', kind: 'living' as const, position: { x: 0, y: 0 } },
      { id: 'district-seed-2', kind: 'living' as const, position: { x: 4, y: 4 } },
    ];
    const singleSeed = [seeds[0]];
    if (singleSeed[0] === undefined) throw new Error('The formula test requires a seed.');
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
        seeds: singleSeed,
        position: { x: 2, y: 0 },
        kind: 'living',
      }),
    ).toBe(0.75);
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
