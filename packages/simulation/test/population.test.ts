import { describe, expect, it } from 'vitest';
import { createSimulation, type SimulationSnapshot } from '../src/index';

const livingPlacement = {
  type: 'place-zone' as const,
  zoneType: 'living' as const,
  rect: { x: -5, y: -5, width: 13, height: 13 },
  expectedCost: 4,
};

function advanceOneTick(
  simulation: ReturnType<typeof createSimulation>,
  workBudget = Number.MAX_SAFE_INTEGER,
): SimulationSnapshot {
  let result = simulation.advanceTickWork(workBudget);
  while (result.status !== 'committed') result = simulation.advanceTickWork(workBudget);
  return simulation.getSnapshot();
}

function advanceUntil(
  simulation: ReturnType<typeof createSimulation>,
  predicate: (snapshot: SimulationSnapshot) => boolean,
  maximumTicks = 160,
): SimulationSnapshot {
  let snapshot = simulation.getSnapshot();
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    snapshot = advanceOneTick(simulation);
    if (predicate(snapshot)) return snapshot;
  }
  throw new Error(`Condition was not reached after ${String(maximumTicks)} ticks.`);
}

function createControlledHousingSimulation(): ReturnType<typeof createSimulation> {
  const simulation = createSimulation({
    seed: 1,
    planningChance: 1,
    constructionLaborRequirements: { 'single-house': 1 },
    populationGrowthRollOverride: 0,
  });
  simulation.placeZone(livingPlacement);
  return simulation;
}

describe('population growth', () => {
  it('creates one stable citizen in an unoccupied vacant home cell', () => {
    const simulation = createControlledHousingSimulation();
    const snapshot = advanceUntil(simulation, (candidate) => candidate.population === 5);
    const newCitizen = snapshot.citizens.find((citizen) => citizen.id === 'citizen-5');
    if (newCitizen === undefined) throw new Error('Expected the first grown citizen.');
    if (newCitizen.homeBuildingId === null) throw new Error('Expected a home assignment.');

    const home = snapshot.buildings.find((building) => building.id === newCitizen.homeBuildingId);
    if (home === undefined) throw new Error('Expected the selected home to remain present.');

    expect(snapshot.completedHomeCapacity).toBeGreaterThanOrEqual(snapshot.population);
    expect(home.state.kind).toBe('complete');
    expect(home.assignments.residentCitizenIds).toContain(newCitizen.id);
    expect(home.assignments.residentCitizenIds.length).toBeLessThanOrEqual(1);
    expect(home.physicalCells).toContainEqual(newCitizen.position);
    expect(
      new Set(snapshot.citizens.map((citizen) => `${citizen.position.x},${citizen.position.y}`))
        .size,
    ).toBe(snapshot.population);
    expect(newCitizen.workBuildingId).toBeNull();
    expect(simulation.getMetrics()).toMatchObject({
      populationGrowthAttempts: 1,
      populationGrowthSuccesses: 1,
    });
  });

  it('does not grow when completed home capacity equals population', () => {
    const simulation = createControlledHousingSimulation();
    const snapshot = advanceUntil(
      simulation,
      (candidate) =>
        candidate.completedHomeCapacity === candidate.population && candidate.population > 0,
    );

    expect(snapshot.population).toBe(4);
    expect(snapshot.completedHomeCapacity).toBe(snapshot.population);
    expect(simulation.getMetrics()).toMatchObject({
      populationGrowthAttempts: 0,
      populationGrowthSuccesses: 0,
    });
  });
});
