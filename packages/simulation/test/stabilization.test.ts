import { describe, expect, it } from 'vitest';
import { createSimulation, type DistrictSeedKind } from '../src/index';

const cadenceConfiguration = {
  chunkSize: 8,
  initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
  homePosition: { x: 0, y: 0 },
  workplacePosition: { x: 8, y: 8 },
  seed: 7744,
  citizenCount: 2,
  activityDurationTicks: 2,
  developmentEvaluationIntervalTicks: 100,
} as const;

function stepSimulation(simulation: ReturnType<typeof createSimulation>, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.step();
}

function placeSeedSequence(kind: DistrictSeedKind, expectedCosts: readonly number[]): void {
  const simulation = createSimulation({
    citizenCount: 0,
    startingData: 1_000,
  });
  for (const [index, expectedCost] of expectedCosts.entries()) {
    expect(simulation.getCurrentDistrictSeedCost(kind)).toBe(expectedCost);
    const position = { x: 6 + index, y: kind === 'living' ? 6 : 8 };
    const preview = simulation.previewDistrictSeed({ kind, position });
    expect(preview).toEqual({ valid: true, cost: expectedCost });
    const result = simulation.placeDistrictSeed({ kind, position });
    expect(result).toMatchObject({ accepted: true, cost: expectedCost });
  }
}

describe('post-Step-7 observation and pricing stability', () => {
  it('produces the same final authoritative JSON when snapshots are taken after every step', () => {
    const unobserved = createSimulation(cadenceConfiguration);
    stepSimulation(unobserved, 120);

    const observedSnapshots = createSimulation(cadenceConfiguration);
    for (let index = 0; index < 120; index += 1) {
      observedSnapshots.step();
      observedSnapshots.getSnapshot();
    }
    expect(JSON.stringify(observedSnapshots.getSnapshot())).toBe(
      JSON.stringify(unobserved.getSnapshot()),
    );
    expect(observedSnapshots.getDeterminismHash()).toBe(unobserved.getDeterminismHash());
  });

  it('keeps irregular snapshot batches equivalent to an unobserved run', () => {
    const observed = createSimulation(cadenceConfiguration);
    const unobserved = createSimulation(cadenceConfiguration);
    const batches = [3, 1, 9, 2, 17, 4, 11, 23, 5, 31, 14] as const;
    for (const batch of batches) {
      stepSimulation(observed, batch);
      stepSimulation(unobserved, batch);
      observed.getSnapshot();
    }
    expect(JSON.stringify(observed.getSnapshot())).toBe(JSON.stringify(unobserved.getSnapshot()));
    expect(observed.getDeterminismHash()).toBe(unobserved.getDeterminismHash());
  });

  it('keeps repeated snapshots and determinism hashes state-neutral', () => {
    const simulation = createSimulation(cadenceConfiguration);
    stepSimulation(simulation, 37);
    const before = JSON.stringify(simulation.getSnapshot());
    const hash = simulation.getDeterminismHash();
    for (let index = 0; index < 5; index += 1) {
      expect(JSON.stringify(simulation.getSnapshot())).toBe(before);
      expect(simulation.getDeterminismHash()).toBe(hash);
    }
    expect(JSON.stringify(simulation.getSnapshot())).toBe(before);
  });

  it('keeps bounded demand queries out of authoritative hashes and JSON', () => {
    const simulation = createSimulation({ ...cadenceConfiguration, demandQueryMaxCells: 64 });
    stepSimulation(simulation, 12);
    const before = JSON.stringify(simulation.getSnapshot());
    const hash = simulation.getDeterminismHash();
    const chunk = simulation.getDemandChunk({ x: 0, y: 0 });
    if (chunk === undefined) throw new Error('The initial demand chunk is required.');
    (chunk.cells[0] as { living: number }).living = 999;
    simulation.queryDemandRegion({ x: 0, y: 0, width: 8, height: 8 });
    expect(JSON.stringify(simulation.getSnapshot())).toBe(before);
    expect(simulation.getDeterminismHash()).toBe(hash);
  });

  it('uses the exact state-aware Living price sequence', () => {
    placeSeedSequence('living', [10, 13, 16, 20]);
  });

  it('uses the exact state-aware Working price sequence', () => {
    placeSeedSequence('working', [12, 15, 19, 24]);
  });

  it('does not advance a same-type price after a rejected placement', () => {
    const simulation = createSimulation({ citizenCount: 0, startingData: 100 });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 6, y: 6 } }),
    ).toMatchObject({ accepted: true, cost: 10 });
    expect(simulation.getCurrentDistrictSeedCost('living')).toBe(13);
    expect(simulation.placeDistrictSeed({ kind: 'working', position: { x: 6, y: 6 } })).toEqual({
      accepted: false,
      reason: 'occupied',
    });
    expect(simulation.getCurrentDistrictSeedCost('living')).toBe(13);
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 7, y: 6 } }),
    ).toMatchObject({ accepted: true, cost: 13 });
  });

  it('charges the same current cost that preview reports', () => {
    const simulation = createSimulation({ citizenCount: 0, startingData: 100 });
    const preview = simulation.previewDistrictSeed({ kind: 'living', position: { x: 6, y: 6 } });
    expect(preview).toEqual({ valid: true, cost: 10 });
    const result = simulation.placeDistrictSeed({ kind: 'living', position: { x: 6, y: 6 } });
    expect(result).toMatchObject({ accepted: true, cost: preview.valid ? preview.cost : -1 });
  });
});
