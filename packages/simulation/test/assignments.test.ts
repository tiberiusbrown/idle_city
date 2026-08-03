import { describe, expect, it } from 'vitest';
import { createSimulation, type SimulationSnapshot } from '../src/index';

const livingPlacement = {
  type: 'place-zone' as const,
  zoneType: 'living' as const,
  rect: { x: -5, y: -5, width: 13, height: 13 },
  expectedCost: 4,
};

const workingOrigin = { x: 9, y: -5 };

function advanceOneTick(simulation: ReturnType<typeof createSimulation>): SimulationSnapshot {
  let result = simulation.advanceTickWork(Number.MAX_SAFE_INTEGER);
  while (result.status !== 'committed') {
    result = simulation.advanceTickWork(Number.MAX_SAFE_INTEGER);
  }
  return simulation.getSnapshot();
}

function advanceUntil(
  simulation: ReturnType<typeof createSimulation>,
  predicate: (snapshot: SimulationSnapshot) => boolean,
  maximumTicks = 400,
): SimulationSnapshot {
  let snapshot = simulation.getSnapshot();
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    snapshot = advanceOneTick(simulation);
    if (predicate(snapshot)) return snapshot;
  }
  throw new Error(`Condition was not reached after ${String(maximumTicks)} ticks.`);
}

function placeWorkingZone(simulation: ReturnType<typeof createSimulation>): void {
  const snapshot = simulation.getSnapshot();
  simulation.placeZone({
    type: 'place-zone',
    zoneType: 'working',
    rect: {
      x: workingOrigin.x,
      y: workingOrigin.y,
      width: 13,
      height: 13,
    },
    expectedCost: snapshot.nextZoneCosts.working,
  });
}

function footprintDistance(
  left: SimulationSnapshot['buildings'][number],
  right: SimulationSnapshot['buildings'][number],
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const leftCell of left.physicalCells) {
    for (const rightCell of right.physicalCells) {
      distance = Math.min(
        distance,
        Math.abs(leftCell.x - rightCell.x) + Math.abs(leftCell.y - rightCell.y),
      );
    }
  }
  return distance;
}

function completeInitialHomeAndOpenWorkplace(
  simulation: ReturnType<typeof createSimulation>,
): SimulationSnapshot {
  simulation.placeZone(livingPlacement);
  advanceUntil(simulation, (snapshot) =>
    snapshot.buildings.some(
      (building) => building.state.kind === 'complete' && building.archetypeId === 'single-house',
    ),
  );
  placeWorkingZone(simulation);
  return advanceOneTick(simulation);
}

describe('home and work assignments', () => {
  it('assigns an unassigned citizen on house completion without exceeding capacity', () => {
    const simulation = createSimulation({
      seed: 1,
      planningChance: 1,
      constructionLaborRequirements: { 'single-house': 1 },
    });
    simulation.placeZone(livingPlacement);

    const snapshot = advanceUntil(simulation, (candidate) =>
      candidate.buildings.some(
        (building) => building.state.kind === 'complete' && building.archetypeId === 'single-house',
      ),
    );
    const house = snapshot.buildings.find(
      (building) => building.state.kind === 'complete' && building.archetypeId === 'single-house',
    );
    if (house === undefined) throw new Error('Expected a completed house.');

    expect(house.assignments.residentCitizenIds).toHaveLength(1);
    expect(snapshot.citizens.filter((citizen) => citizen.homeBuildingId !== null)).toHaveLength(1);
    expect(snapshot.citizens.filter((citizen) => citizen.homeBuildingId === house.id)).toHaveLength(
      1,
    );
  });

  it('reassigns to a shorter commute without interrupting the current trip', () => {
    const simulation = createSimulation({
      seed: 1,
      planningChance: 1,
      constructionLaborRequirements: { 'single-house': 1, 'small-shop': 1 },
      homeStayTicks: 2,
      workStayTicks: 2,
    });
    let previous = completeInitialHomeAndOpenWorkplace(simulation);
    let reassigned: SimulationSnapshot | undefined;
    let changedIndex = -1;
    for (let tick = 0; tick < 220; tick += 1) {
      const candidate = advanceOneTick(simulation);
      changedIndex = candidate.citizens.findIndex((citizen, index) => {
        const oldCitizen = previous.citizens[index];
        return (
          oldCitizen !== undefined &&
          oldCitizen.workBuildingId !== null &&
          citizen.workBuildingId !== null &&
          citizen.workBuildingId !== oldCitizen.workBuildingId &&
          ((oldCitizen.activity !== null &&
            citizen.activity?.buildingId === oldCitizen.activity.buildingId) ||
            (oldCitizen.route !== null &&
              citizen.route?.destinationBuildingId === oldCitizen.route.destinationBuildingId &&
              citizen.route.purpose === oldCitizen.route.purpose))
        );
      });
      if (changedIndex >= 0) {
        reassigned = candidate;
        break;
      }
      previous = candidate;
    }
    if (changedIndex < 0) throw new Error('Expected a preserved reassignment candidate.');
    if (reassigned === undefined) throw new Error('Expected a reassignment snapshot.');

    const oldCitizen = previous.citizens[changedIndex];
    const newCitizen = reassigned.citizens[changedIndex];
    if (
      oldCitizen === undefined ||
      newCitizen === undefined ||
      oldCitizen.workBuildingId === null ||
      newCitizen.workBuildingId === null
    ) {
      throw new Error('Expected the reassigned citizen to have both workplace references.');
    }
    const home = reassigned.buildings.find((building) => building.id === newCitizen.homeBuildingId);
    const oldWorkplace = reassigned.buildings.find(
      (building) => building.id === oldCitizen.workBuildingId,
    );
    const newWorkplace = reassigned.buildings.find(
      (building) => building.id === newCitizen.workBuildingId,
    );
    if (home === undefined || oldWorkplace === undefined || newWorkplace === undefined) {
      throw new Error('Expected the reassignment buildings to remain in the snapshot.');
    }

    expect(footprintDistance(home, newWorkplace)).toBeLessThan(
      footprintDistance(home, oldWorkplace),
    );
    expect(oldWorkplace.assignments.workerCitizenIds).not.toContain(newCitizen.id);
    expect(newWorkplace.assignments.workerCitizenIds).toContain(newCitizen.id);
    if (oldCitizen.activity !== null) {
      expect(newCitizen.activity?.buildingId).toBe(oldCitizen.activity.buildingId);
    } else if (oldCitizen.route !== null) {
      expect(newCitizen.route?.destinationBuildingId).toBe(oldCitizen.route.destinationBuildingId);
      expect(newCitizen.route?.purpose).toBe(oldCitizen.route.purpose);
    }
    expect(newWorkplace.assignments.workerCitizenIds.length).toBeLessThanOrEqual(4);
  });

  it('produces exactly one Data when a work trip enters the workplace', () => {
    const simulation = createSimulation({
      seed: 1,
      planningChance: 1,
      constructionLaborRequirements: { 'single-house': 1, 'small-shop': 1 },
      homeStayTicks: 2,
      workStayTicks: 2,
    });
    completeInitialHomeAndOpenWorkplace(simulation);
    let previous = simulation.getSnapshot();

    const entry = advanceUntil(simulation, (snapshot) => snapshot.data > previous.data, 260);
    expect(entry.data - previous.data).toBe(1);
    expect(entry.citizens.some((citizen) => citizen.activity?.kind === 'work-stay')).toBe(true);
    previous = entry;
    expect(advanceOneTick(simulation).data).toBe(previous.data);
    expect(advanceOneTick(simulation).data).toBe(previous.data);
  });
});
