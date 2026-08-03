import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_PHASE_DEFINITIONS,
  CONSTRUCTION_PHASE_ORDER,
  DISTRICT_SEED_COSTS,
  compareConstructionAssignments,
  constructionPhaseLaborRequired,
  createSimulation,
  isExteriorEntrance,
  isInsideFootprint,
  selectProjectStagingCells,
  type ConstructionAssignmentCandidate,
  type GridPosition,
  type Simulation,
  type SimulationConfig,
  type SimulationSnapshot,
} from '../src/index';

const constructionBuildings = [
  { id: 'home-1', type: 'home' as const, origin: { x: 1, y: 1 } },
  { id: 'home-2', type: 'home' as const, origin: { x: 1, y: 8 } },
  { id: 'home-3', type: 'home' as const, origin: { x: 8, y: 1 } },
  { id: 'workplace-1', type: 'workplace' as const, origin: { x: 8, y: 8 } },
];

function constructionCitizens(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `citizen-${String(index + 1)}`,
    homeBuildingId: `home-${String((index % 3) + 1)}`,
    workplaceBuildingId: 'workplace-1',
  }));
}

const constructionConfig: SimulationConfig = {
  chunkSize: 8,
  initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
  initialBuildings: constructionBuildings,
  initialCitizens: constructionCitizens(3),
  populationCap: 3,
  activityDurationTicks: 1,
  developmentEvaluationIntervalTicks: 1,
  startingData: DISTRICT_SEED_COSTS.living,
  seed: 2026,
};

function startProject(overrides: SimulationConfig = {}): {
  readonly simulation: Simulation;
  readonly snapshot: SimulationSnapshot;
} {
  const {
    citizenCount: requestedCitizenCount,
    housingCapacity: ignoredHousingCapacity,
    workplaceCapacity: ignoredWorkplaceCapacity,
    initialCitizens: explicitCitizens,
    ...safeOverrides
  } = overrides;
  void ignoredHousingCapacity;
  void ignoredWorkplaceCapacity;
  const count = explicitCitizens?.length ?? requestedCitizenCount ?? 3;
  const simulation = createSimulation({
    ...constructionConfig,
    ...safeOverrides,
    initialCitizens: explicitCitizens ?? constructionCitizens(count),
  });
  expect(simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }).accepted).toBe(
    true,
  );
  for (let tick = 0; tick < 120; tick += 1) {
    simulation.step();
    const snapshot = simulation.getSnapshot();
    if (snapshot.constructionProjects.length > 0) return { simulation, snapshot };
  }
  throw new Error('The deterministic developer did not start a construction project.');
}

function runUntilCompletion(overrides: SimulationConfig = {}): SimulationSnapshot {
  const { simulation } = startProject(overrides);
  for (let tick = 0; tick < 500; tick += 1) {
    simulation.step();
    const snapshot = simulation.getSnapshot();
    if (snapshot.structural.constructionProjectsCompleted > 0) return snapshot;
  }
  throw new Error('The construction project did not complete within the test budget.');
}

function positionKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

describe('Step 9.6 citizen construction labor', () => {
  it('selects three distinct staging cells in entrance, perimeter, and row-major order', () => {
    const footprint = { x: 2, y: 2, width: 3, height: 3 };
    const entrance = { x: 3, y: 1 };
    const selected = selectProjectStagingCells(footprint, {
      entrance,
      isActive: () => true,
      isWalkable: () => true,
    });
    expect(selected).toHaveLength(3);
    expect(selected[0]).toEqual(entrance);
    expect(new Set(selected.map(positionKey)).size).toBe(3);
    expect(selected.every((cell) => isExteriorEntrance(cell, footprint))).toBe(true);

    const envelopeOnly = selectProjectStagingCells(footprint, {
      entrance,
      isActive: () => true,
      isWalkable: (cell) =>
        cell.x >= footprint.x - 1 &&
        cell.x <= footprint.x + footprint.width &&
        cell.y >= footprint.y - 1 &&
        cell.y <= footprint.y + footprint.height,
    });
    expect(envelopeOnly).toEqual([]);
  });

  it('stores exactly three staging cells outside each active project footprint', () => {
    const { snapshot } = startProject();
    const project = snapshot.constructionProjects[0];
    if (project === undefined) throw new Error('A project is required.');
    expect(project.stagingCells).toHaveLength(3);
    expect(project.stagingCells[0]).toEqual(project.entrance);
    expect(new Set(project.stagingCells.map(positionKey)).size).toBe(3);
    expect(project.stagingCells.every((cell) => !isInsideFootprint(cell, project.footprint))).toBe(
      true,
    );
  });

  it('uses project, shortest route, staging index, and citizen ID assignment ordering', () => {
    const candidates: ConstructionAssignmentCandidate[] = [
      {
        projectId: 'construction-project-2',
        routeLength: 1,
        stagingIndex: 0,
        citizenId: 'citizen-1',
      },
      {
        projectId: 'construction-project-1',
        routeLength: 4,
        stagingIndex: 1,
        citizenId: 'citizen-2',
      },
      {
        projectId: 'construction-project-1',
        routeLength: 2,
        stagingIndex: 1,
        citizenId: 'citizen-3',
      },
      {
        projectId: 'construction-project-1',
        routeLength: 2,
        stagingIndex: 0,
        citizenId: 'citizen-2',
      },
      {
        projectId: 'construction-project-1',
        routeLength: 2,
        stagingIndex: 0,
        citizenId: 'citizen-1',
      },
    ];
    const sorted = [...candidates].sort(compareConstructionAssignments);
    expect(
      sorted.map(
        ({ projectId, routeLength, stagingIndex, citizenId }) =>
          `${projectId}:${String(routeLength)}:${String(stagingIndex)}:${citizenId}`,
      ),
    ).toEqual([
      'construction-project-1:2:0:citizen-1',
      'construction-project-1:2:0:citizen-2',
      'construction-project-1:2:1:citizen-3',
      'construction-project-1:4:1:citizen-2',
      'construction-project-2:1:0:citizen-1',
    ]);
    expect([...candidates].reverse().sort(compareConstructionAssignments)).toEqual(sorted);
  });

  it('recruits only at an ordinary home/work boundary and preserves the resume destination', () => {
    const { simulation } = startProject();
    let previous = simulation.getSnapshot();
    let observedAssignment = false;
    for (let tick = 0; tick < 160; tick += 1) {
      simulation.step();
      const current = simulation.getSnapshot();
      for (const citizen of current.citizens) {
        const prior = previous.citizens.find(({ id }) => id === citizen.id);
        if (prior === undefined) continue;
        if (prior.constructionProjectId !== null || citizen.constructionProjectId === null)
          continue;
        expect(['home', 'work']).toContain(prior.activity);
        expect(prior.route).toEqual([]);
        expect(citizen.resumeDestinationBuildingId).toBe(
          prior.activity === 'home' ? prior.workplaceBuildingId : prior.homeBuildingId,
        );
        observedAssignment = true;
      }
      previous = current;
      if (observedAssignment) break;
    }
    expect(observedAssignment).toBe(true);
  });

  it('routes construction commutes to staging, arrives before labor, and contributes one unit per worker', () => {
    const { simulation } = startProject();
    let previous = simulation.getSnapshot();
    let observedArrival = false;
    let observedLabor = false;
    for (let tick = 0; tick < 160; tick += 1) {
      simulation.step();
      const current = simulation.getSnapshot();
      const previousProject = previous.constructionProjects[0];
      const currentProject = current.constructionProjects[0];
      if (previousProject !== undefined && currentProject !== undefined) {
        if (previousProject.phase === currentProject.phase) {
          const laborDelta =
            current.structural.constructionLaborUnits - previous.structural.constructionLaborUnits;
          const constructingWorkers = current.citizens.filter(
            (citizen) => citizen.activity === 'constructing',
          );
          expect(laborDelta).toBe(constructingWorkers.length);
          if (
            previousProject.workerCount > 0 &&
            currentProject.workerCount > 0 &&
            constructingWorkers.length === 0
          ) {
            expect(laborDelta).toBe(0);
            expect(currentProject.ticksSinceLastLabor).toBe(
              previousProject.ticksSinceLastLabor + 1,
            );
          }
        }
      }
      if (
        current.structural.constructionWorkerArrivals >
        previous.structural.constructionWorkerArrivals
      ) {
        observedArrival = true;
      }
      for (const citizen of current.citizens.filter(
        ({ activity }) => activity === 'constructing',
      )) {
        expect(citizen.constructionProjectId).toBe(currentProject?.id ?? null);
        expect(citizen.constructionStagingCell).toEqual(citizen.position);
        const prior = previous.citizens.find(({ id }) => id === citizen.id);
        if (prior?.activity === 'constructing') {
          expect(
            Math.abs(citizen.position.x - prior.position.x) +
              Math.abs(citizen.position.y - prior.position.y),
          ).toBeLessThanOrEqual(1);
        }
      }
      if (current.structural.constructionLaborUnits > previous.structural.constructionLaborUnits) {
        observedLabor = true;
        const workCompleted = current.completedWorkActivities - previous.completedWorkActivities;
        const serviceCompleted =
          current.completedServiceActivities - previous.completedServiceActivities;
        if (workCompleted === 0) {
          expect(current.dataGeneratedThisTickBySource.work).toBe(0);
        }
        if (serviceCompleted === 0) {
          expect(current.dataGeneratedThisTickBySource.service).toBe(0);
        }
        expect(current.dataGeneratedThisTick).toBe(
          current.dataGeneratedThisTickBySource.work +
            current.dataGeneratedThisTickBySource.service,
        );
      }
      previous = current;
      if (observedArrival && observedLabor) break;
    }
    expect(observedArrival).toBe(true);
    expect(observedLabor).toBe(true);
    expect(simulation.getSnapshot().structural.constructionCommutes).toBeGreaterThan(0);
  });

  it('uses the fixed labor contract and makes one-worker construction slower than full staffing', () => {
    expect(CONSTRUCTION_PHASE_DEFINITIONS).toEqual({
      survey: { laborRequired: 2, maxWorkers: 1 },
      blueprint: { laborRequired: 3, maxWorkers: 1 },
      foundation: { laborRequired: 8, maxWorkers: 2 },
      frame: { laborRequired: 18, maxWorkers: 3 },
      completion: { laborRequired: 2, maxWorkers: 2 },
    });
    expect(constructionPhaseLaborRequired('frame')).toBe(18);
    const oneWorker = runUntilCompletion({
      initialCitizens: constructionCitizens(1),
      populationCap: 1,
    });
    const fullStaff = runUntilCompletion({ initialCitizens: constructionCitizens(3) });
    expect(oneWorker.tick).toBeGreaterThan(fullStaff.tick);
    expect(oneWorker.structural.constructionPhaseCompletions).toBe(5);
    expect(fullStaff.structural.constructionPhaseCompletions).toBe(5);
  });

  it('pauses without eligible workers and makes no labor progress', () => {
    const { simulation } = startProject({
      initialCitizens: [
        {
          id: 'citizen-1',
          homeBuildingId: 'home-1',
          workplaceBuildingId: 'workplace-1',
          activity: 'work',
        },
      ],
      populationCap: 1,
      activityDurationTicks: 100_000,
    });
    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    const snapshot = simulation.getSnapshot();
    const project = snapshot.constructionProjects[0];
    if (project === undefined) throw new Error('The understaffed project should remain active.');
    expect(project.phase).toBe('survey');
    expect(project.phaseLaborCompleted).toBe(0);
    expect(project.paused).toBe(true);
    expect(snapshot.structural.constructionAssignmentsAccepted).toBe(0);
    expect(snapshot.structural.constructionLaborUnits).toBe(0);
    expect(snapshot.structural.constructionPausedProjectTicks).toBeGreaterThan(0);
  });

  it('transitions at most one phase per tick, carries no labor, and creates the building only at final labor', () => {
    const { simulation } = startProject();
    let previous = simulation.getSnapshot();
    let transitions = 0;
    let sawActiveProject = false;
    let completed = false;
    for (let tick = 0; tick < 180; tick += 1) {
      simulation.step();
      const current = simulation.getSnapshot();
      const previousProject = previous.constructionProjects[0];
      const currentProject = current.constructionProjects[0];
      if (previousProject !== undefined) sawActiveProject = true;
      if (previousProject !== undefined && currentProject !== undefined) {
        const previousIndex = CONSTRUCTION_PHASE_ORDER.indexOf(previousProject.phase);
        const currentIndex = CONSTRUCTION_PHASE_ORDER.indexOf(currentProject.phase);
        expect(currentIndex - previousIndex).toBeGreaterThanOrEqual(0);
        expect(currentIndex - previousIndex).toBeLessThanOrEqual(1);
        if (currentIndex > previousIndex) {
          transitions += 1;
          expect(currentProject.phaseLaborCompleted).toBe(0);
          expect(currentProject.phaseTicksElapsed).toBe(0);
        }
      }
      if (current.constructionProjects.length > 0) {
        expect(current.buildings).toHaveLength(4);
      } else if (current.structural.constructionProjectsCompleted > 0) {
        completed = true;
        expect(current.buildings.length).toBe(5);
        break;
      }
      previous = current;
    }
    expect(sawActiveProject).toBe(true);
    expect(transitions).toBe(4);
    expect(completed).toBe(true);
  });

  it('releases the stable highest worker when the frame cap drops and resumes ordinary travel', () => {
    const { simulation } = startProject({
      constructionPhaseDurations: { frame: 100 },
    });
    let previous = simulation.getSnapshot();
    let observedCapRelease = false;
    for (let tick = 0; tick < 180; tick += 1) {
      simulation.step();
      const current = simulation.getSnapshot();
      const previousProject = previous.constructionProjects[0];
      const currentProject = current.constructionProjects[0];
      if (previousProject?.phase === 'frame' && currentProject?.phase === 'completion') {
        const previousWorkers = previous.citizens
          .filter(({ constructionProjectId }) => constructionProjectId === previousProject.id)
          .map(({ id }) => id)
          .sort();
        const currentWorkers = current.citizens
          .filter(({ constructionProjectId }) => constructionProjectId === currentProject.id)
          .map(({ id }) => id)
          .sort();
        expect(previousWorkers).toEqual(['citizen-1', 'citizen-2', 'citizen-3']);
        expect(currentWorkers).toEqual(['citizen-1', 'citizen-2']);
        expect(current.structural.constructionWorkerReleases).toBe(
          previous.structural.constructionWorkerReleases + 1,
        );
        const released = current.citizens.find(({ id }) => id === 'citizen-3');
        expect(released?.constructionProjectId).toBeNull();
        expect(['commuting-to-work', 'commuting-home', 'home', 'work']).toContain(
          released?.activity,
        );
        observedCapRelease = true;
        break;
      }
      previous = current;
    }
    expect(observedCapRelease).toBe(true);
  });

  it('preserves deterministic replay when snapshots are read at different cadences', () => {
    const left = createSimulation(constructionConfig);
    const right = createSimulation(constructionConfig);
    expect(left.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }).accepted).toBe(
      true,
    );
    expect(right.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }).accepted).toBe(
      true,
    );
    for (let tick = 0; tick < 160; tick += 1) {
      left.getSnapshot();
      left.getSnapshot();
      left.step();
      right.step();
      expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
      expect(left.getSnapshot()).toEqual(right.getSnapshot());
    }
  });
});
