import { describe, expect, it } from 'vitest';
import { stableHash } from '@idle-city/shared';
import {
  buildMovementProposals,
  calculateCityDemand,
  calculateDistrictSeedInfluence,
  createSimulation,
  findGridPath,
  isMovementReplanDue,
  recoveryQueuePenalty,
  replanMovementRoute,
  resolveMovementReservations,
  routeTieProfile,
  ROUTE_DIRECTION_ORDERS,
  ROUTE_TIE_PROFILE_COUNT,
  squareDistance,
  type Building,
  type MovementCandidate,
} from '../src/index';

function candidate(
  id: string,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  critical = false,
): MovementCandidate {
  return {
    id,
    position: { ...from },
    route: [{ ...from }, { ...to }],
    routeIndex: 0,
    waitTicks: 0,
    tripStartedTick: 1,
    critical,
  };
}

function stepUntil(
  simulation: ReturnType<typeof createSimulation>,
  predicate: (snapshot: ReturnType<typeof simulation.getSnapshot>) => boolean,
  maximumTicks: number,
): void {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    simulation.step();
    if (predicate(simulation.getSnapshot())) return;
  }
  throw new Error(`Condition was not reached within ${String(maximumTicks)} ticks.`);
}

describe('Step 10.5 deterministic route diversity and recovery', () => {
  it('derives all four route profiles from stable citizen IDs', () => {
    expect(ROUTE_TIE_PROFILE_COUNT).toBe(4);
    expect(['citizen-1', 'citizen-2', 'citizen-3', 'citizen-4'].map(routeTieProfile)).toEqual([
      1, 2, 3, 0,
    ]);
    expect(
      ['citizen-1', 'citizen-2', 'citizen-3', 'citizen-4'].map(
        (id) => Number.parseInt(stableHash(id), 16) % 4,
      ),
    ).toEqual(['citizen-1', 'citizen-2', 'citizen-3', 'citizen-4'].map(routeTieProfile));
  });

  it('uses the four exact direction orders and keeps equal-cost paths shortest', () => {
    expect(ROUTE_DIRECTION_ORDERS).toEqual([
      [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ],
      [
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
        { x: 1, y: 0 },
      ],
      [
        { x: -1, y: 0 },
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ],
    ]);
    const paths = [0, 1, 2, 3].map((profile) =>
      findGridPath(
        { width: 9, height: 9, isWalkable: () => true },
        { x: 0, y: 0 },
        { x: 8, y: 8 },
        { routeTieProfile: profile },
      ),
    );
    expect(paths.map((path) => path.length - 1)).toEqual([16, 16, 16, 16]);
    expect(paths[0]?.[1]).toEqual({ x: 1, y: 0 });
    expect(paths[1]?.[1]).toEqual({ x: 0, y: 1 });
    expect(new Set(paths.map((path) => JSON.stringify(path))).size).toBeGreaterThan(1);

    const blocked = new Set(['2,1', '2,2', '3,2', '4,2']);
    const detouredPaths = [0, 1, 2, 3].map((profile) =>
      findGridPath(
        {
          width: 9,
          height: 9,
          isWalkable: (position) => !blocked.has(`${String(position.x)},${String(position.y)}`),
        },
        { x: 0, y: 0 },
        { x: 8, y: 8 },
        { routeTieProfile: profile },
      ),
    );
    expect(detouredPaths.map((path) => path.length - 1)).toEqual([16, 16, 16, 16]);
  });

  it('is independent of array order and uses the profile on every route call site', () => {
    const grid = {
      chunkSize: 4,
      activeChunks: [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ],
      isWalkable: (position: { readonly x: number; readonly y: number }) =>
        !(position.x === 2 && position.y === 1),
    } as const;
    const left = findGridPath(grid, { x: 0, y: 0 }, { x: 5, y: 5 }, { routeTieProfile: 2 });
    const right = findGridPath(
      { ...grid, activeChunks: [...grid.activeChunks].reverse() },
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { routeTieProfile: 2 },
    );
    expect(right).toEqual(left);
  });

  it('triggers recovery at 4, 8, 12 and applies the exact queue penalty', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(isMovementReplanDue)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
    ]);
    expect([0, 1, 2, 3, 4].map(recoveryQueuePenalty)).toEqual([0, 50, 100, 150, 150]);
  });

  it('blocks transient occupied cells, installs only changed routes, and retains failures', () => {
    const currentRoute = Array.from({ length: 7 }, (_, x) => ({ x, y: 2 }));
    const alternate = replanMovementRoute({
      chunkSize: 8,
      activeChunks: [{ x: 0, y: 0 }],
      start: { x: 0, y: 2 },
      goal: { x: 6, y: 2 },
      currentRoute,
      currentRouteIndex: 0,
      temporaryBlocked: new Set(['2,2']),
      isWalkable: (position) =>
        position.x >= 0 && position.x < 7 && position.y >= 0 && position.y < 5,
      maxNodes: 1_000,
    });
    expect(alternate.status).toBe('found');
    expect(alternate.routeChanged).toBe(true);
    expect(alternate.path.some((position) => position.x === 2 && position.y === 2)).toBe(false);
    expect(alternate.path.length - 1).toBeGreaterThan(currentRoute.length - 1);

    const identical = replanMovementRoute({
      chunkSize: 8,
      activeChunks: [{ x: 0, y: 0 }],
      start: { x: 0, y: 2 },
      goal: { x: 6, y: 2 },
      currentRoute,
      currentRouteIndex: 0,
      temporaryBlocked: new Set(),
      isWalkable: (position) =>
        position.x >= 0 && position.x < 7 && position.y >= 0 && position.y < 5,
      maxNodes: 1_000,
    });
    expect(identical.status).toBe('found');
    expect(identical.routeChanged).toBe(false);

    const failed = replanMovementRoute({
      chunkSize: 8,
      activeChunks: [{ x: 0, y: 0 }],
      start: { x: 0, y: 2 },
      goal: { x: 6, y: 2 },
      currentRoute,
      currentRouteIndex: 0,
      temporaryBlocked: new Set(['1,2']),
      isWalkable: (position) => position.y === 2 && position.x >= 0 && position.x < 7,
      maxNodes: 1_000,
    });
    expect(failed.status).toBe('no-path');
    expect(failed.routeChanged).toBe(false);
    expect(failed.path).toEqual([]);
    expect(currentRoute).toEqual(Array.from({ length: 7 }, (_, x) => ({ x, y: 2 })));
  });
});

describe('Step 10.5 critical construction movement', () => {
  it('gives exactly one critical builder priority only in a same-target conflict', () => {
    const proposals = buildMovementProposals({
      candidates: [
        candidate('ordinary', { x: 1, y: 0 }, { x: 0, y: 0 }),
        candidate('critical', { x: 0, y: 1 }, { x: 0, y: 0 }, true),
      ],
      isActive: () => true,
      isWalkable: () => true,
    });
    const resolution = resolveMovementReservations({
      proposals,
      movingOccupancy: new Map([
        ['1,0', 'ordinary'],
        ['0,1', 'critical'],
      ]),
    });
    expect(resolution.accepted.map(({ citizenId }) => citizenId)).toEqual(['critical']);
    expect(resolution.criticalPriorityWins).toBe(1);

    const nonConflicting = resolveMovementReservations({
      proposals: buildMovementProposals({
        candidates: [
          candidate('ordinary', { x: 1, y: 0 }, { x: 2, y: 0 }),
          candidate('critical', { x: 0, y: 1 }, { x: 0, y: 0 }, true),
        ],
        isActive: () => true,
        isWalkable: () => true,
      }),
      movingOccupancy: new Map([
        ['1,0', 'ordinary'],
        ['0,1', 'critical'],
      ]),
    });
    expect(nonConflicting.accepted.map(({ citizenId }) => citizenId).sort()).toEqual([
      'critical',
      'ordinary',
    ]);
    expect(nonConflicting.criticalPriorityWins).toBe(0);
  });

  it('promotes an assigned reachable builder on the twelfth zero-labor tick and clears it', () => {
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 20,
      housingCapacity: 20,
      workplaceCapacity: 20,
      populationCap: 20,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: 10,
    });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }).accepted,
    ).toBe(true);

    let promotedProjectId: string | undefined;
    let observedNoLaborAtEleven = false;
    stepUntil(
      simulation,
      (snapshot) => {
        const project = snapshot.constructionProjects.find(
          ({ criticalBuilderId }) => criticalBuilderId !== null,
        );
        if (project === undefined) {
          const assignedNoLabor = snapshot.constructionProjects.find(
            ({ workerCount, phaseLaborCompleted }) => workerCount > 0 && phaseLaborCompleted === 0,
          );
          if (assignedNoLabor?.ticksSinceLastLabor === 11) observedNoLaborAtEleven = true;
          return false;
        }
        promotedProjectId = project.id;
        expect(project.ticksSinceLastLabor).toBe(12);
        expect(project.criticalBuilderReason).toContain('12 zero-labor ticks');
        expect(
          snapshot.constructionProjects.filter(
            ({ criticalBuilderId }) => criticalBuilderId !== null,
          ),
        ).toHaveLength(1);
        expect(snapshot.citizens.find(({ id }) => id === project.criticalBuilderId)).toMatchObject({
          activity: 'commuting-to-construction',
          criticalBuilderProjectId: project.id,
          criticalBuilderReason: project.criticalBuilderReason,
        });
        return true;
      },
      120,
    );
    expect(promotedProjectId).toBeDefined();
    expect(observedNoLaborAtEleven).toBe(true);

    const beforeClears = simulation.getSnapshot().structural.constructionCriticalClears;
    stepUntil(
      simulation,
      (snapshot) => snapshot.structural.constructionCriticalClears > beforeClears,
      120,
    );
    expect(simulation.getSnapshot().structural.constructionCriticalClears).toBeGreaterThan(
      beforeClears,
    );
  });

  it('does not promote a project with no assigned eligible worker', () => {
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 0,
      housingCapacity: 0,
      workplaceCapacity: 0,
      populationCap: 0,
      developmentEvaluationIntervalTicks: 1,
      startingData: 10,
    });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }).accepted,
    ).toBe(true);
    for (let tick = 0; tick < 40; tick += 1) simulation.step();
    const snapshot = simulation.getSnapshot();
    expect(
      snapshot.constructionProjects.some(({ criticalBuilderId }) => criticalBuilderId !== null),
    ).toBe(false);
    expect(snapshot.structural.constructionCriticalNoEligibleWorkerTicks).toBeGreaterThan(0);
  });
});

describe('Step 10.5 square district influence', () => {
  it('uses exact Chebyshev center, edge, corner, outside, and positive-boundary values', () => {
    const seeds = [{ id: 'living-1', kind: 'living' as const, position: { x: 0, y: 0 } }];
    expect(squareDistance({ x: 0, y: 0 }, { x: 10, y: 4 })).toBe(10);
    expect(
      calculateDistrictSeedInfluence({ seeds, position: { x: 0, y: 0 }, kind: 'living' }),
    ).toBe(1);
    expect(
      calculateDistrictSeedInfluence({ seeds, position: { x: 10, y: 0 }, kind: 'living' }),
    ).toBeCloseTo(1 / 11, 6);
    expect(
      calculateDistrictSeedInfluence({ seeds, position: { x: 10, y: 10 }, kind: 'living' }),
    ).toBeCloseTo(1 / 11, 6);
    expect(
      calculateDistrictSeedInfluence({ seeds, position: { x: 11, y: 0 }, kind: 'living' }),
    ).toBe(0);
    expect(
      calculateDistrictSeedInfluence({ seeds, position: { x: 4, y: 0 }, kind: 'living' }),
    ).toBe(0.636364);
  });

  it('keeps additive matching influence capped and exposes square preview coverage', () => {
    const seeds = [
      { id: 'living-1', kind: 'living' as const, position: { x: 0, y: 0 } },
      { id: 'living-2', kind: 'living' as const, position: { x: 4, y: 4 } },
    ];
    expect(
      calculateDistrictSeedInfluence({ seeds, position: { x: 4, y: 4 }, kind: 'living' }),
    ).toBe(1);

    const simulation = createSimulation({ startingData: 100, citizenCount: 0 });
    const info = simulation.getDistrictSeedPlacementInfo({
      kind: 'living',
      position: { x: 15, y: 1 },
    });
    expect(info.sideLength).toBe(21);
    expect(info.coveredCells).toHaveLength(441);
    expect(info.activeCoveredCellCount + info.inactiveCoveredCellCount).toBe(441);
    expect(info.coveredCells).toEqual(
      expect.arrayContaining([
        { x: 5, y: -9 },
        { x: 25, y: 11 },
      ]),
    );
    expect(
      info.activeCoveredCells.every((cell) =>
        info.coveredCells.some((other) => other.x === cell.x && other.y === cell.y),
      ),
    ).toBe(true);
    expect(simulation.placeDistrictSeed({ kind: 'living', position: info.position }).accepted).toBe(
      true,
    );
    expect(simulation.getSnapshot().seeds[0]?.position).toEqual(info.position);
  });

  it('uses Chebyshev distance for Services local-capacity coverage', () => {
    const home: Building = {
      id: 'home',
      type: 'home',
      footprint: { x: 0, y: 0, width: 3, height: 3 },
      entrance: { x: 1, y: 3 },
      capacity: 20,
    };
    const workplace: Building = {
      id: 'workplace',
      type: 'workplace',
      footprint: { x: 0, y: 6, width: 5, height: 5 },
      entrance: { x: 1, y: 5 },
      capacity: 20,
    };
    const service: Building = {
      id: 'service',
      type: 'service',
      footprint: { x: 4, y: 4, width: 4, height: 4 },
      entrance: { x: 4, y: 3 },
      capacity: 8,
    };
    const citizens = Array.from({ length: 20 }, () => ({
      homeBuildingId: home.id,
      workplaceBuildingId: workplace.id,
      serviceNeed: 2,
    }));
    const demand = calculateCityDemand({
      width: 20,
      height: 20,
      buildings: [home, workplace, service],
      citizens,
      metrics: { space: 1, access: 1, activity: 1 },
      servicesEnabled: true,
    });
    const cell = (x: number, y: number) =>
      demand.cells.find((candidate) => candidate.position.x === x && candidate.position.y === y);
    expect(cell(12, 8)?.services).toBe(cell(12, 12)?.services);
    expect(cell(13, 13)?.services).toBeGreaterThan(cell(12, 12)?.services ?? 0);
  });
});
