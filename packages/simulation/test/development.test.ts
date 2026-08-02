import { describe, expect, it } from 'vitest';
import {
  compareDevelopmentCandidates,
  CONSTRUCTION_PHASE_ORDER,
  createSimulation,
  DISTRICT_SEED_COSTS,
  footprintCells,
  isExteriorEntrance,
  isInsideFootprint,
  type DevelopmentCandidate,
} from '../src/index';

function seededSimulation(kind: 'living' | 'working') {
  const simulation = createSimulation({
    chunkSize: 8,
    initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
    homePosition: { x: 0, y: 0 },
    workplacePosition: { x: 8, y: 8 },
    citizenCount: 1,
    startingData: DISTRICT_SEED_COSTS[kind],
    developmentEvaluationIntervalTicks: 1,
  });
  expect(simulation.placeDistrictSeed({ kind, position: { x: 4, y: 4 } }).accepted).toBe(true);
  return simulation;
}

function candidate(overrides: Partial<DevelopmentCandidate> = {}): DevelopmentCandidate {
  return {
    buildingType: 'home',
    anchor: { x: 1, y: 1 },
    footprint: { x: 1, y: 1, width: 3, height: 3 },
    entrance: { x: 1, y: 0 },
    entranceOrder: 0,
    score: 0.5,
    primaryReason: {
      code: 'local-matching-demand',
      text: 'Local demand for home capacity is high.',
      scoreContribution: 0.2,
    },
    localMatchingDemand: 0.5,
    seedInfluence: 0.5,
    complementaryUse: 0.5,
    entranceAccessibility: 0.5,
    expectedAccessImprovement: 0.5,
    sameUseSaturation: 0.5,
    constructionCost: 0.36,
    spatialFactor: 0.5,
    ...overrides,
  };
}

describe('deterministic developer evaluation and construction', () => {
  it('creates a home candidate from Living influence', () => {
    const simulation = seededSimulation('living');
    simulation.step();
    const snapshot = simulation.getSnapshot();
    const candidate = snapshot.developmentCandidates[0];
    const project = snapshot.constructionProjects[0];
    expect(candidate?.buildingType).toBe('home');
    expect(candidate?.seedInfluence).toBeGreaterThan(0);
    expect(candidate?.primaryReason.code).toBe('matching-seed-influence');
    expect(project?.buildingType).toBe('home');
  });

  it('creates a workplace candidate from Working influence', () => {
    const simulation = seededSimulation('working');
    simulation.step();
    const snapshot = simulation.getSnapshot();
    expect(snapshot.developmentCandidates[0]?.buildingType).toBe('workplace');
    expect(snapshot.constructionProjects[0]?.buildingType).toBe('workplace');
  });

  it('keeps candidates and projects on complete active footprints with exterior entrances', () => {
    const simulation = seededSimulation('living');
    simulation.step();
    const snapshot = simulation.getSnapshot();
    const candidate = snapshot.developmentCandidates[0];
    const project = snapshot.constructionProjects[0];
    if (candidate === undefined || project === undefined) throw new Error('A project is required.');
    expect(candidate.footprint).toEqual(project.footprint);
    expect(candidate.entrance).toEqual(project.entrance);
    expect(isExteriorEntrance(project.entrance, project.footprint)).toBe(true);
    expect(
      footprintCells(project.footprint).every((cell) =>
        snapshot.activeChunks.some(
          (chunk) =>
            chunk.chunk.x === Math.floor(cell.x / snapshot.chunkSize) &&
            chunk.chunk.y === Math.floor(cell.y / snapshot.chunkSize),
        ),
      ),
    ).toBe(true);
  });

  it('rejects overlapping or protected footprint candidates', () => {
    const simulation = seededSimulation('living');
    simulation.step();
    const snapshot = simulation.getSnapshot();
    expect(snapshot.structural.developmentFootprintsRejected).toBeGreaterThan(0);
    expect(
      snapshot.developmentCandidates.every((candidate) =>
        snapshot.buildings.every((building) =>
          footprintCells(candidate.footprint).every(
            (cell) => !isInsideFootprint(cell, building.footprint),
          ),
        ),
      ),
    ).toBe(true);
  });

  it('uses the documented score and all stable tie-breakers', () => {
    expect(
      compareDevelopmentCandidates(candidate({ score: 0.7 }), candidate({ score: 0.6 })),
    ).toBeLessThan(0);
    expect(
      compareDevelopmentCandidates(
        candidate({ seedInfluence: 0.8 }),
        candidate({ seedInfluence: 0.7 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareDevelopmentCandidates(
        candidate({ expectedAccessImprovement: 0.8 }),
        candidate({ expectedAccessImprovement: 0.7 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareDevelopmentCandidates(
        candidate({ footprint: { x: 1, y: 1, width: 3, height: 3 } }),
        candidate({ footprint: { x: 1, y: 2, width: 3, height: 3 } }),
      ),
    ).toBeLessThan(0);
    expect(
      compareDevelopmentCandidates(
        candidate({ footprint: { x: 1, y: 1, width: 3, height: 3 } }),
        candidate({ footprint: { x: 2, y: 1, width: 3, height: 3 } }),
      ),
    ).toBeLessThan(0);
    expect(
      compareDevelopmentCandidates(
        candidate({ buildingType: 'home' }),
        candidate({ buildingType: 'workplace' }),
      ),
    ).toBeLessThan(0);
    expect(
      compareDevelopmentCandidates(
        candidate({ entranceOrder: 0 }),
        candidate({ entranceOrder: 1 }),
      ),
    ).toBeLessThan(0);
  });

  it('reserves the full footprint and advances exact fixed phases to matching geometry', () => {
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 1,
      constructionPhaseDurations: {
        survey: 1,
        blueprint: 1,
        foundation: 1,
        frame: 1,
        completion: 1,
      },
    });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 4, y: 4 } }).accepted,
    ).toBe(true);
    simulation.step();
    const reserved = simulation.getSnapshot();
    const project = reserved.constructionProjects[0];
    if (project === undefined) throw new Error('A construction project is required.');
    expect(project.phase).toBe('survey');
    expect(reserved.structural.allocatedOccupancyBuffers).toBeGreaterThan(0);
    const phases: string[] = [project.phase];
    for (let index = 0; index < CONSTRUCTION_PHASE_ORDER.length - 1; index += 1) {
      simulation.step();
      const next = simulation.getSnapshot();
      const nextProject = next.constructionProjects[0];
      if (nextProject !== undefined) phases.push(nextProject.phase);
    }
    expect(phases).toEqual(['survey', 'blueprint', 'foundation', 'frame', 'completion']);
    simulation.step();
    const completed = simulation.getSnapshot();
    expect(completed.constructionProjects).toHaveLength(1);
    expect(completed.constructionProjects[0]?.id).toBe('construction-project-2');
    expect(completed.buildings).toContainEqual({
      id: 'home-2',
      type: 'home',
      footprint: project.footprint,
      entrance: project.entrance,
      capacity: 4,
    });
  });

  it('keeps IDs, RNG state, detached projects, and repeated runs stable', () => {
    const left = seededSimulation('living');
    const right = seededSimulation('living');
    const beforeRandom = left.getSnapshot().randomState;
    for (let tick = 0; tick < 80; tick += 1) {
      left.step();
      right.step();
    }
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
    expect(left.getSnapshot().randomState).toBe(beforeRandom);
    const snapshot = left.getSnapshot();
    const firstBuildingId = snapshot.buildings[0]?.id;
    if (firstBuildingId === undefined) throw new Error('A building is required.');
    (snapshot.buildings[0] as { id: string }).id = 'mutated';
    expect(left.getSnapshot().buildings[0]?.id).toBe(firstBuildingId);
    const project = left.getSnapshot().constructionProjects[0];
    if (project !== undefined) {
      (project.footprint as { x: number }).x = 999;
      expect(left.getSnapshot().constructionProjects[0]?.footprint.x).not.toBe(999);
    }
    const candidateSimulation = seededSimulation('living');
    candidateSimulation.step();
    const candidateSnapshot = candidateSimulation.getSnapshot();
    const detachedCandidate = candidateSnapshot.developmentCandidates[0];
    if (detachedCandidate !== undefined) {
      (detachedCandidate.footprint as { x: number }).x = 999;
      expect(candidateSimulation.getSnapshot().developmentCandidates[0]?.footprint.x).not.toBe(999);
    }
  });

  it('runs 10,000 ticks without a stuck project or invalid geometry', () => {
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 1,
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 10,
    });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 4, y: 4 } }).accepted,
    ).toBe(true);
    for (let tick = 0; tick < 10_000; tick += 1) simulation.step();
    const snapshot = simulation.getSnapshot();
    expect(snapshot.structural.constructionProjectsStarted).toBeGreaterThan(0);
    expect(
      snapshot.structural.constructionProjectsCompleted + snapshot.constructionProjects.length,
    ).toBe(snapshot.structural.constructionProjectsStarted);
    expect(snapshot.constructionProjects.every((project) => project.phaseTicksRemaining > 0)).toBe(
      true,
    );
    expect(
      snapshot.constructionProjects.every((project) => project.totalTicksElapsed < 10_000),
    ).toBe(true);
    expect(
      snapshot.buildings.every((building) =>
        isExteriorEntrance(building.entrance, building.footprint),
      ),
    ).toBe(true);
  });
});
