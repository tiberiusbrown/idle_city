import { describe, expect, it } from 'vitest';
import { createSimulation, type BuildingSnapshot, type SimulationSnapshot } from '../src/index';

const livingPlacement = {
  type: 'place-zone' as const,
  zoneType: 'living' as const,
  rect: { x: -5, y: -5, width: 13, height: 13 },
  expectedCost: 4,
};

function advanceOneTick(simulation: ReturnType<typeof createSimulation>): SimulationSnapshot {
  let result = simulation.advanceTickWork(Number.MAX_SAFE_INTEGER);
  while (result.status !== 'committed') {
    result = simulation.advanceTickWork(Number.MAX_SAFE_INTEGER);
  }
  return simulation.getSnapshot();
}

function firstBuilding(snapshot: SimulationSnapshot): BuildingSnapshot {
  const building = snapshot.buildings.find((candidate) => candidate.id === 'building-1');
  if (building === undefined) throw new Error('Expected the first planned building.');
  return building;
}

function advanceUntil(
  simulation: ReturnType<typeof createSimulation>,
  predicate: (snapshot: SimulationSnapshot) => boolean,
  maximumTicks = 120,
): SimulationSnapshot {
  let snapshot = simulation.getSnapshot();
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    snapshot = advanceOneTick(simulation);
    if (predicate(snapshot)) return snapshot;
  }
  throw new Error(`Condition was not reached after ${String(maximumTicks)} ticks.`);
}

describe('construction assignments and labor', () => {
  it('fills a project in stable order and contributes labor only after arrival', () => {
    const simulation = createSimulation({
      seed: 1,
      planningChance: 1,
      constructionLaborRequirements: { 'single-house': 3 },
    });
    simulation.placeZone(livingPlacement);
    advanceUntil(simulation, (snapshot) => snapshot.buildings.length > 0);

    let snapshot = advanceUntil(
      simulation,
      (candidate) => firstBuilding(candidate).assignments.constructionWorkerIds.length === 1,
    );
    let building = firstBuilding(snapshot);
    expect(building.assignments.constructionWorkerIds).toEqual(['citizen-4']);
    expect(building.assignments.constructionWorkerIds.length).toBe(1);
    expect(
      snapshot.citizens.filter((citizen) => citizen.constructionBuildingId !== null),
    ).toHaveLength(1);
    expect(building.state).toEqual({ kind: 'incomplete', laborCompleted: 0, laborRequired: 3 });

    snapshot = advanceUntil(simulation, (candidate) =>
      candidate.citizens.some((citizen) => citizen.activity?.kind === 'construction'),
    );
    building = firstBuilding(snapshot);
    expect(building.state).toEqual({ kind: 'incomplete', laborCompleted: 1, laborRequired: 3 });
  });

  it('completes at the exact labor threshold and releases workers without changing geometry', () => {
    const simulation = createSimulation({
      seed: 1,
      planningChance: 1,
      constructionLaborRequirements: { 'single-house': 2 },
    });
    simulation.placeZone(livingPlacement);
    advanceUntil(simulation, (snapshot) => snapshot.buildings.length > 0);
    advanceUntil(
      simulation,
      (snapshot) =>
        firstBuilding(snapshot).state.kind === 'incomplete' &&
        firstBuilding(snapshot).state.laborCompleted === 1,
    );

    const before = firstBuilding(simulation.getSnapshot());
    if (before.state.kind !== 'incomplete') throw new Error('Expected an incomplete building.');
    const after = firstBuilding(advanceOneTick(simulation));

    expect(after.id).toBe(before.id);
    expect(after.zoneId).toBe(before.zoneId);
    expect(after.origin).toEqual(before.origin);
    expect(after.transform).toBe(before.transform);
    expect(after.physicalCells).toEqual(before.physicalCells);
    expect(after.exclusionCells).toEqual(before.exclusionCells);
    expect(after.state).toEqual({ kind: 'complete' });
    expect(after.assignments.constructionWorkerIds).toEqual([]);
    const completedWorkerIds = new Set(before.assignments.constructionWorkerIds);
    const completedWorkers = simulation
      .getSnapshot()
      .citizens.filter((citizen) => completedWorkerIds.has(citizen.id));
    expect(completedWorkers).toHaveLength(before.assignments.constructionWorkerIds.length);
    expect(completedWorkers.every((citizen) => citizen.constructionBuildingId !== before.id)).toBe(
      true,
    );
    expect(completedWorkers.every((citizen) => citizen.activity?.buildingId !== before.id)).toBe(
      true,
    );
  });
});
