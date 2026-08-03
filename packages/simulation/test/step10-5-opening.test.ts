import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/index';

describe('Step 10.5 opening authority', () => {
  it('starts empty with one deterministic idle citizen', () => {
    const simulation = createSimulation();
    const snapshot = simulation.getSnapshot();
    expect(snapshot.buildings).toHaveLength(0);
    expect(snapshot.constructionProjects).toHaveLength(0);
    expect(snapshot.seeds).toHaveLength(0);
    expect(snapshot.data).toBe(0);
    expect(snapshot.citizens).toHaveLength(1);
    expect(snapshot.citizens[0]?.activity).toBe('idle');
    expect(snapshot.citizens[0]?.homeBuildingId).toBeNull();
    expect(snapshot.citizens[0]?.workplaceBuildingId).toBeNull();
  });

  it('gathers one Data without advancing time and locks after both seed kinds', () => {
    const simulation = createSimulation();
    const before = simulation.getSnapshot();
    expect(simulation.gatherManualData()).toEqual({ accepted: true, amount: 1 });
    expect(simulation.getSnapshot().tick).toBe(before.tick);
    expect(simulation.getSnapshot().data).toBe(1);
    for (let index = 0; index < 21; index += 1) simulation.gatherManualData();
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 10, y: 10 } }).accepted,
    ).toBe(true);
    expect(
      simulation.placeDistrictSeed({ kind: 'working', position: { x: 30, y: 30 } }).accepted,
    ).toBe(true);
    expect(simulation.gatherManualData()).toEqual({ accepted: false, reason: 'unavailable' });
  });

  it('keeps repeated manual gathering deterministic and unchanged in tick and RNG state', () => {
    const left = createSimulation();
    const right = createSimulation();
    const initial = left.getSnapshot();
    for (let index = 0; index < 5; index += 1) {
      expect(left.gatherManualData()).toEqual({ accepted: true, amount: 1 });
      expect(right.gatherManualData()).toEqual({ accepted: true, amount: 1 });
      expect(left.getSnapshot()).toEqual(right.getSnapshot());
    }
    const snapshot = left.getSnapshot();
    expect(snapshot.tick).toBe(initial.tick);
    expect(snapshot.randomState).toBe(initial.randomState);
    expect(snapshot.data).toBe(5);
  });

  it.each([
    ['living', { x: 10, y: 10 }],
    ['working', { x: 30, y: 30 }],
  ] as const)('remains available after only a %s seed', (kind, position) => {
    const simulation = createSimulation({ startingData: 100 });
    expect(simulation.placeDistrictSeed({ kind, position })).toMatchObject({ accepted: true });
    const before = simulation.getSnapshot();
    expect(simulation.gatherManualData()).toEqual({ accepted: true, amount: 1 });
    const after = simulation.getSnapshot();
    expect(after.manualDataAvailable).toBe(true);
    expect(after.tick).toBe(before.tick);
  });

  it('rejects seed placement without locking manual gathering', () => {
    const simulation = createSimulation();
    const before = simulation.getSnapshot();
    expect(simulation.placeDistrictSeed({ kind: 'living', position: { x: 10, y: 10 } })).toEqual({
      accepted: false,
      reason: 'insufficient-data',
    });
    expect(simulation.getSnapshot()).toEqual(before);
    expect(simulation.gatherManualData()).toEqual({ accepted: true, amount: 1 });
    expect(simulation.getSnapshot().manualDataAvailable).toBe(true);
  });

  it('rejects gathering after both seeds with an exact mutation-free snapshot and hash', () => {
    const simulation = createSimulation({ startingData: 100 });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 10, y: 10 } }).accepted,
    ).toBe(true);
    expect(
      simulation.placeDistrictSeed({ kind: 'working', position: { x: 30, y: 30 } }).accepted,
    ).toBe(true);
    const before = simulation.getSnapshot();
    const hash = simulation.getDeterminismHash();
    expect(simulation.gatherManualData()).toEqual({ accepted: false, reason: 'unavailable' });
    expect(simulation.getSnapshot()).toEqual(before);
    expect(simulation.getDeterminismHash()).toBe(hash);
  });

  it('keeps manual gathering deterministic and available after only one seed', () => {
    const simulation = createSimulation();
    const before = simulation.getSnapshot();
    expect(simulation.gatherManualData()).toEqual({ accepted: true, amount: 1 });
    const after = simulation.getSnapshot();
    expect(after.tick).toBe(before.tick);
    expect(after.randomState).toBe(before.randomState);
    expect(after.data).toBe(before.data + 1);
    expect(after.manualDataAvailable).toBe(true);
  });
});
