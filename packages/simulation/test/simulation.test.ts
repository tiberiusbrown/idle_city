import { describe, expect, it } from 'vitest';
import { isInsideFootprint } from '../src/index';
import { createSimulation } from '../src/index';

describe('simulation', () => {
  it('spawns citizens at an exterior home entrance and moves at most one cell per tick', () => {
    const simulation = createSimulation({ seed: 22, citizenCount: 4 });
    const initial = simulation.getSnapshot();
    const home = initial.buildings.find((building) => building.type === 'home');
    if (home === undefined) throw new Error('A home is required.');
    expect(initial.citizens.every((citizen) => citizen.position.x === home.entrance.x)).toBe(true);
    expect(initial.citizens.every((citizen) => citizen.position.y === home.entrance.y)).toBe(true);
    expect(
      initial.citizens.every((citizen) => !isInsideFootprint(citizen.position, home.footprint)),
    ).toBe(true);

    for (let tick = 0; tick < 100; tick += 1) {
      const before = simulation.getSnapshot();
      simulation.step();
      const after = simulation.getSnapshot();
      after.citizens.forEach((citizen, index) => {
        const previous = before.citizens[index];
        if (previous === undefined) throw new Error('Citizen ordering changed between snapshots.');
        expect(
          Math.abs(citizen.position.x - previous.position.x) +
            Math.abs(citizen.position.y - previous.position.y),
        ).toBeLessThanOrEqual(1);
        for (const building of after.buildings) {
          expect(isInsideFootprint(citizen.position, building.footprint)).toBe(false);
        }
      });
    }
  });

  it('eventually completes a home-to-work trip to the workplace entrance', () => {
    const simulation = createSimulation({ citizenCount: 1 });
    for (let tick = 0; tick < 100 && simulation.getSnapshot().completedTrips === 0; tick += 1) {
      simulation.step();
    }
    const snapshot = simulation.getSnapshot();
    const workplace = snapshot.buildings.find((building) => building.type === 'workplace');
    if (workplace === undefined) throw new Error('A workplace is required.');
    expect(snapshot.completedTrips).toBe(1);
    expect(snapshot.citizens[0]?.activity).toBe('work');
    expect(snapshot.citizens[0]?.position).toEqual(workplace.entrance);
  });

  it('is reproducible and returns detached chunk summaries and queries', () => {
    const left = createSimulation({ seed: 9876 });
    const right = createSimulation({ seed: 9876 });
    for (let tick = 0; tick < 250; tick += 1) {
      left.step();
      right.step();
    }
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
    const snapshot = left.getSnapshot();
    const firstCitizen = snapshot.citizens[0];
    if (firstCitizen === undefined) throw new Error('The default scenario requires citizens.');
    const originalX = firstCitizen.position.x;
    (firstCitizen.position as { x: number }).x = 999;
    expect(left.getSnapshot().citizens[0]?.position.x).toBe(originalX);
    expect('cells' in snapshot.demand).toBe(false);

    const demandChunk = left.getDemandChunk({ x: 0, y: 0 });
    if (demandChunk === undefined) throw new Error('The initial demand chunk must exist.');
    const originalDemandX = demandChunk.cells[0]?.position.x;
    if (originalDemandX === undefined) throw new Error('The demand chunk must contain cells.');
    (demandChunk.cells[0]?.position as { x: number }).x = 999;
    expect(left.getDemandChunk({ x: 0, y: 0 })?.cells[0]?.position.x).toBe(originalDemandX);
    const region = left.queryDemandRegion({ x: -1, y: -1, width: 3, height: 3 });
    expect(region.inactiveCellCount).toBe(5);
    expect(region.cells).toHaveLength(4);
  });

  it('reports bounded indicators and generates deterministic Data for completed work', () => {
    const configuration = {
      seed: 1,
      citizenCount: 1,
      activityDurationTicks: 1,
    } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    expect(left.getSnapshot().data).toBe(0);

    let generatedData = false;
    for (let tick = 0; tick < 160; tick += 1) {
      const before = left.getSnapshot();
      left.step();
      right.step();
      const after = left.getSnapshot();
      expect(after).toEqual(right.getSnapshot());
      expect(after.data).toBeGreaterThanOrEqual(before.data);
      expect(after.data - before.data).toBeCloseTo(after.dataGeneratedThisTick, 6);
      for (const value of Object.values(after.metrics)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      generatedData ||= after.dataGeneratedThisTick > 0;
    }

    expect(generatedData).toBe(true);
    expect(left.getSnapshot().completedActivities).toBeGreaterThan(0);
    expect(left.getSnapshot().data).toBeGreaterThan(0);
  });

  it('supports co-located non-overlapping building footprints', () => {
    const simulation = createSimulation({
      citizenCount: 1,
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 8, y: 8 },
      activityDurationTicks: 1,
    });
    for (let tick = 0; tick < 80; tick += 1) simulation.step();
    expect(simulation.getSnapshot().completedTrips).toBeGreaterThan(0);
  });

  it('exposes explicit chunk activation and query APIs without render-time input', () => {
    const simulation = createSimulation({
      initialChunkRegion: { minX: 0, minY: 0, width: 1, height: 1 },
      activeChunkLimit: 2,
    });
    expect(Object.keys(simulation).sort()).toEqual([
      'activateChunk',
      'getDemandChunk',
      'getDeterminismHash',
      'getSnapshot',
      'placeDistrictSeed',
      'queryDemandRegion',
      'step',
    ]);
    expect(simulation.activateChunk({ x: 2, y: 0 })).toEqual({
      accepted: false,
      reason: 'not-adjacent',
    });
    expect(simulation.activateChunk({ x: 1, y: 0 })).toEqual({
      accepted: true,
      chunk: { x: 1, y: 0 },
      activeChunkCount: 2,
    });
    const before = simulation.getSnapshot();
    expect(simulation.activateChunk({ x: 1, y: 0 })).toEqual({
      accepted: false,
      reason: 'already-active',
    });
    expect(simulation.activateChunk({ x: 0, y: 1 })).toEqual({
      accepted: false,
      reason: 'active-chunk-limit',
    });
    expect(simulation.getSnapshot()).toEqual(before);
  });
});
