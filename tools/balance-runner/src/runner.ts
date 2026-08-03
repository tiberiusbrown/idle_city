import {
  CONSTRUCTION_PHASE_ORDER,
  chunkCoordinateForPosition,
  chunkKey,
  canonicalTrafficEdge,
  buildingClearanceZoneCells,
  compareChunks,
  createSimulation,
  DISTRICT_SEED_COSTS,
  footprintCells,
  isExteriorEntrance,
  type ActivateChunkCommand,
  type CityMetrics,
  type ChunkActivationResult,
  type CommandResult,
  type CorePurchaseInfo,
  type CorePurchaseResult,
  type BuildingType,
  type DemandTotals,
  type DistrictSeed,
  type DistrictSeedPlacementInfo,
  type PlaceDistrictSeedCommand,
  type PurchaseCoreCommand,
  type ResearchFocus,
  type SimulationConfig,
  type SimulationSnapshot,
  type SimulationStructuralCounters,
  type TrafficEdgeSnapshot,
} from '@idle-city/simulation';

export const balanceScenarioNames = [
  'empty-city-opening',
  'manual-data-opening',
  'distant-seed-construction',
  'unhoused-half-speed-construction',
  'housed-full-speed-construction',
  'first-home-work-transition',
  'four-worker-workplace',
  'blocked-building-side',
  'multi-access-service',
  'crossing-open-land',
  'builder-under-congestion',
  'overlapping-square-seeds',
] as const;

export type BalanceScenarioName = (typeof balanceScenarioNames)[number];

export interface ScheduledDistrictSeedCommand {
  /** The simulation tick at which this command is applied; tick 0 is pre-step. */
  readonly tick: number;
  readonly command: PlaceDistrictSeedCommand;
}

export interface ScheduledChunkActivationCommand {
  /** The simulation tick at which this activation is applied; tick 0 is pre-step. */
  readonly tick: number;
  readonly command: ActivateChunkCommand;
}

export interface ScheduledCorePurchaseCommand {
  /** The simulation tick at which this purchase is applied; tick 0 is pre-step. */
  readonly tick: number;
  readonly command: PurchaseCoreCommand;
}

interface BalanceScenarioDefinition {
  readonly config: SimulationConfig;
  readonly commands: readonly ScheduledDistrictSeedCommand[];
  readonly activations: readonly ScheduledChunkActivationCommand[];
  readonly corePurchases?: readonly ScheduledCorePurchaseCommand[];
  readonly manualData?: readonly ScheduledManualDataCommand[];
}

export interface ScheduledManualDataCommand {
  readonly tick: number;
}

/** Deterministic established-city fixture used by commuter and progression scenarios. */
export function createEstablishedCityFixture(citizenCount: number): SimulationConfig {
  if (!Number.isSafeInteger(citizenCount) || citizenCount < 0) {
    throw new Error('Established-city fixture citizenCount must be a non-negative integer.');
  }
  const homes = Array.from({ length: citizenCount }, (_, index) => ({
    id: `home-${String(index + 1)}`,
    type: 'home' as const,
    origin: { x: 4 + (index % 8) * 8, y: 4 + Math.floor(index / 8) * 8 },
  }));
  const workplaceCount = Math.ceil(citizenCount / 4);
  const workplaces = Array.from({ length: workplaceCount }, (_, index) => ({
    id: `workplace-${String(index + 1)}`,
    type: 'workplace' as const,
    origin: { x: 4 + (index % 4) * 8, y: 48 + Math.floor(index / 4) * 8 },
  }));
  return {
    chunkSize: 32,
    initialActiveRegion: { minX: 0, minY: 0, width: 5, height: 5 },
    pathSearchBudget: 1_000_000,
    initialBuildings: [...homes, ...workplaces],
    initialCitizens: Array.from({ length: citizenCount }, (_, index) => ({
      id: `citizen-${String(index + 1)}`,
      homeBuildingId: `home-${String(index + 1)}`,
      workplaceBuildingId: `workplace-${String(Math.floor(index / 4) + 1)}`,
    })),
    housingCapacity: 1,
    workplaceCapacity: 4,
    populationCap: Math.max(1, citizenCount),
    developmentHomeCapacity: 1,
    developmentWorkplaceCapacity: 4,
  };
}

function createCrossingFixture(): SimulationConfig {
  const homes = [
    { id: 'home-1', type: 'home' as const, origin: { x: 4, y: 4 } },
    { id: 'home-2', type: 'home' as const, origin: { x: 68, y: 4 } },
    { id: 'home-3', type: 'home' as const, origin: { x: 4, y: 100 } },
    { id: 'home-4', type: 'home' as const, origin: { x: 68, y: 100 } },
  ];
  const workplaces = [
    { id: 'workplace-1', type: 'workplace' as const, origin: { x: 4, y: 52 } },
    { id: 'workplace-2', type: 'workplace' as const, origin: { x: 68, y: 52 } },
  ];
  return {
    chunkSize: 32,
    initialActiveRegion: { minX: 0, minY: 0, width: 5, height: 5 },
    pathSearchBudget: 1_000_000,
    initialBuildings: [...homes, ...workplaces],
    initialCitizens: [
      { id: 'citizen-1', homeBuildingId: 'home-1', workplaceBuildingId: 'workplace-2' },
      { id: 'citizen-2', homeBuildingId: 'home-2', workplaceBuildingId: 'workplace-1' },
      { id: 'citizen-3', homeBuildingId: 'home-3', workplaceBuildingId: 'workplace-2' },
      { id: 'citizen-4', homeBuildingId: 'home-4', workplaceBuildingId: 'workplace-1' },
    ],
    activityDurationTicks: 1,
    populationCap: 4,
    developmentEvaluationIntervalTicks: 1_000_000,
  };
}

function createBlockedSideFixture(): SimulationConfig {
  const fixture = createEstablishedCityFixture(4);
  return {
    ...fixture,
    initialBuildings: [
      { id: 'home-1', type: 'home', origin: { x: 4, y: 4 } },
      { id: 'home-2', type: 'home', origin: { x: 4, y: 20 } },
      { id: 'home-3', type: 'home', origin: { x: 4, y: 36 } },
      { id: 'home-4', type: 'home', origin: { x: 4, y: 52 } },
      { id: 'workplace-1', type: 'workplace', origin: { x: 60, y: 28 } },
    ],
    initialCitizens: [1, 2, 3, 4].map((index) => ({
      id: `citizen-${String(index)}`,
      homeBuildingId: `home-${String(index)}`,
      workplaceBuildingId: 'workplace-1',
    })),
  };
}

const scenarioDefinitions: Record<BalanceScenarioName, BalanceScenarioDefinition> = {
  'empty-city-opening': { config: {}, commands: [], activations: [] },
  'manual-data-opening': {
    config: {
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 50, y: 50 } } },
      { tick: 0, command: { kind: 'working', position: { x: 80, y: 80 } } },
    ],
    activations: [],
    manualData: [
      ...Array.from({ length: DISTRICT_SEED_COSTS.living + DISTRICT_SEED_COSTS.working }, () => ({
        tick: 0,
      })),
      { tick: 1 },
    ],
  },
  'distant-seed-construction': {
    config: {
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      startingData: 22,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 100, y: 100 } } },
      { tick: 0, command: { kind: 'working', position: { x: 80, y: 80 } } },
    ],
    activations: [],
  },
  'unhoused-half-speed-construction': {
    config: { startingData: 10, developmentEvaluationIntervalTicks: 1 },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 50, y: 50 } } }],
    activations: [],
  },
  'housed-full-speed-construction': {
    config: {
      ...createEstablishedCityFixture(1),
      startingData: 10,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 20, y: 20 } } }],
    activations: [],
  },
  'first-home-work-transition': {
    config: {
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      startingData: 22,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 50, y: 50 } } },
      { tick: 0, command: { kind: 'working', position: { x: 80, y: 80 } } },
    ],
    activations: [],
  },
  'four-worker-workplace': {
    config: {
      ...createEstablishedCityFixture(4),
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1_000_000,
    },
    commands: [],
    activations: [],
  },
  'blocked-building-side': {
    config: {
      ...createBlockedSideFixture(),
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1_000_000,
    },
    commands: [],
    activations: [],
  },
  'multi-access-service': {
    config: {
      ...createEstablishedCityFixture(20),
      startingData: 22,
      initialBuildings: [
        ...(createEstablishedCityFixture(20).initialBuildings ?? []),
        { id: 'service-1', type: 'service' as const, origin: { x: 20, y: 28 } },
      ],
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1_000_000,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 20, y: 1 } } },
      { tick: 0, command: { kind: 'working', position: { x: 24, y: 15 } } },
    ],
    activations: [],
    corePurchases: [{ tick: 1_000, command: { core: 'services', focus: 'activity' } }],
  },
  'crossing-open-land': {
    config: {
      ...createCrossingFixture(),
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1_000_000,
    },
    commands: [],
    activations: [],
  },
  'builder-under-congestion': {
    config: {
      ...createEstablishedCityFixture(4),
      startingData: 10,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 20, y: 20 } } }],
    activations: [],
  },
  'overlapping-square-seeds': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 2 },
      startingData: 100,
      developmentEvaluationIntervalTicks: 1_000_000,
      citizenCount: 0,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 6, y: 1 } } },
      { tick: 0, command: { kind: 'living', position: { x: 14, y: 1 } } },
    ],
    activations: [],
  },
};

export function isBalanceScenarioName(value: string): value is BalanceScenarioName {
  return balanceScenarioNames.includes(value as BalanceScenarioName);
}

export function getBalanceScenarioConfig(scenario: BalanceScenarioName): SimulationConfig {
  const definition = scenarioDefinitions[scenario];
  return JSON.parse(JSON.stringify(definition.config)) as SimulationConfig;
}

export function getBalanceScenarioCommands(
  scenario: BalanceScenarioName,
): readonly ScheduledDistrictSeedCommand[] {
  const definition = scenarioDefinitions[scenario];
  return definition.commands.map(({ tick, command }) => ({
    tick,
    command: { ...command, position: { ...command.position } },
  }));
}

export function getBalanceScenarioActivations(
  scenario: BalanceScenarioName,
): readonly ScheduledChunkActivationCommand[] {
  const definition = scenarioDefinitions[scenario];
  return definition.activations.map(({ tick, command }) => ({
    tick,
    command: { ...command },
  }));
}

export function getBalanceScenarioCorePurchases(
  scenario: BalanceScenarioName,
): readonly ScheduledCorePurchaseCommand[] {
  const definition = scenarioDefinitions[scenario];
  return (definition.corePurchases ?? []).map(({ tick, command }) => ({
    tick,
    command: { ...command },
  }));
}

export function getBalanceScenarioManualData(
  scenario: BalanceScenarioName,
): readonly ScheduledManualDataCommand[] {
  const definition = scenarioDefinitions[scenario];
  return (definition.manualData ?? []).map(({ tick }) => ({ tick }));
}

export interface BalanceOptions {
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount?: number;
  readonly initialPopulation?: number;
  readonly populationCap?: number;
  readonly populationGrowthCadenceTicks?: number;
  readonly scenario?: BalanceScenarioName;
  readonly commands?: readonly ScheduledDistrictSeedCommand[];
  readonly activations?: readonly ScheduledChunkActivationCommand[];
  readonly corePurchases?: readonly ScheduledCorePurchaseCommand[];
  readonly manualData?: readonly ScheduledManualDataCommand[];
}

export interface BalanceCommandResult {
  readonly tick: number;
  readonly command: PlaceDistrictSeedCommand;
  readonly preview: DistrictSeedPlacementInfo;
  readonly result: CommandResult;
}

export interface BalanceActivationResult {
  readonly tick: number;
  readonly command: ActivateChunkCommand;
  readonly result: ChunkActivationResult;
}

export interface BalanceCorePurchaseResult {
  readonly tick: number;
  readonly command: PurchaseCoreCommand;
  readonly info: CorePurchaseInfo & { readonly reason?: string };
  readonly result: CorePurchaseResult;
}

export interface BalanceManualDataResult {
  readonly tick: number;
  readonly result: ReturnType<ReturnType<typeof createSimulation>['gatherManualData']>;
}

export interface BalanceAssignment {
  readonly citizenId: string;
  readonly homeBuildingId: string | null;
  readonly workplaceBuildingId: string | null;
  readonly activity: SimulationSnapshot['citizens'][number]['activity'];
}

export interface BalanceAccessUsage {
  readonly buildingId: string;
  readonly cell: { readonly x: number; readonly y: number };
  readonly count: number;
}

export interface BalanceMovementSummary {
  readonly proposals: number;
  readonly committedMoves: number;
  readonly blockedMoves: number;
  readonly averageWaitTicks: number;
  readonly maxWaitTicks: number;
  readonly targetConflicts: number;
  readonly dependencyBlocks: number;
  readonly cyclesCommitted: number;
  readonly ordinarySwapsRejected: number;
  readonly replansAttempted: number;
  readonly replansSucceeded: number;
  readonly replansUnchanged: number;
  readonly emergencySwaps: number;
  readonly criticalPriorityWins: number;
}

export interface BalanceConstructionSummary {
  readonly assignmentsOffered: number;
  readonly assignmentsAccepted: number;
  readonly constructionCommutes: number;
  readonly workerArrivals: number;
  readonly laborUnits: number;
  readonly pausedProjectTicks: number;
  readonly phaseCompletions: number;
  readonly workerReleases: number;
  readonly criticalPromotions: number;
  readonly criticalClears: number;
  readonly criticalNoEligibleWorkerTicks: number;
  readonly criticalConflictWins: number;
}

export interface BalanceSummary {
  readonly scenario: BalanceScenarioName;
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount: number;
  readonly populationCap: number;
  readonly populationGrowthCadenceTicks: number;
  readonly completedTrips: number;
  readonly completedActivities: number;
  readonly completedWorkActivities: number;
  readonly completedServiceActivities: number;
  readonly serviceTrips: number;
  readonly serviceUses: number;
  readonly failedServiceDestinationAttempts: number;
  readonly serviceWaitTicks: number;
  readonly data: number;
  readonly dataGeneratedThisTick: number;
  readonly dataGeneratedThisTickBySource: SimulationSnapshot['dataGeneratedThisTickBySource'];
  readonly dataBySource: SimulationSnapshot['dataBySource'];
  readonly core: SimulationSnapshot['core'];
  readonly servicesCore: SimulationSnapshot['servicesCore'];
  readonly researchFocus: ResearchFocus | null;
  readonly averageTripDurationTicks: number;
  readonly metrics: CityMetrics;
  readonly demandTotals: DemandTotals;
  readonly seeds: readonly DistrictSeed[];
  readonly activeChunkCount: number;
  readonly movement: BalanceMovementSummary;
  readonly construction: BalanceConstructionSummary;
  readonly traffic: readonly TrafficEdgeSnapshot[];
  readonly activeTrafficEdges: number;
  /** Current-window sum of all per-edge directional counters. */
  readonly directionalTraversals: number;
  /** Current-window sum of all per-edge total counters. */
  readonly totalTraversals: number;
  readonly trafficTraversalEventsRecorded: number;
  readonly expiredTraversalEvents: number;
  readonly peakActiveEdges: number;
  readonly structuralCounters: SimulationStructuralCounters;
  readonly snapshotChunkSummaries: number;
  readonly snapshotTrafficSummaries: number;
  readonly commandResults: readonly BalanceCommandResult[];
  readonly activationResults: readonly BalanceActivationResult[];
  readonly corePurchaseResults: readonly BalanceCorePurchaseResult[];
  readonly manualDataResults: readonly BalanceManualDataResult[];
  readonly assignments: readonly BalanceAssignment[];
  readonly accessUsage: readonly BalanceAccessUsage[];
  readonly buildingCount: number;
  readonly homeCount: number;
  readonly workplaceCount: number;
  readonly serviceCount: number;
  readonly activeConstructionProjects: number;
  readonly constructionProjectsStarted: number;
  readonly constructionProjectsCompleted: number;
  readonly developmentEvaluations: number;
  readonly developmentJob: SimulationSnapshot['developmentJob'];
  readonly invariantFailures: readonly string[];
  readonly determinismHash: string;
}

function active(
  snapshot: SimulationSnapshot,
  position: { readonly x: number; readonly y: number },
): boolean {
  const coordinate = chunkCoordinateForPosition(position, snapshot.chunkSize);
  return snapshot.activeChunks.some((chunk) => chunk.key === chunkKey(coordinate));
}

function adjacent(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectInvariantFailures(snapshot: SimulationSnapshot): readonly string[] {
  const failures: string[] = [];
  const fail = (message: string): void => {
    failures.push(message);
  };
  const activeKeys = new Set<string>();
  let previousChunk: { readonly x: number; readonly y: number } | undefined;
  for (const chunk of snapshot.activeChunks) {
    if (activeKeys.has(chunk.key)) fail(`duplicate active chunk ${chunk.key}`);
    activeKeys.add(chunk.key);
    if (chunk.key !== chunkKey(chunk.chunk)) fail(`active chunk key mismatch ${chunk.key}`);
    if (previousChunk !== undefined && compareChunks(chunk.chunk, previousChunk) < 0) {
      fail('active chunks are not stably ordered');
    }
    previousChunk = chunk.chunk;
  }
  if (snapshot.activeChunkCount !== activeKeys.size) fail('active chunk count mismatch');
  if (snapshot.structural.activeChunks !== activeKeys.size)
    fail('structural active chunk count mismatch');
  if (snapshot.structural.allocatedChunks !== activeKeys.size)
    fail('allocated chunk count mismatch');
  for (const chunk of snapshot.activeChunks) {
    if (chunk.staticTopologyRevision < 0) {
      fail(`static topology revisions are invalid for ${chunk.key}`);
    }
  }

  const buildingIds = new Set<string>();
  const occupiedCells = new Set<string>();
  const reservedCells = new Set<string>();
  const capacityByType = new Map<BuildingType, number>([
    ['home', 0],
    ['workplace', 0],
    ['service', 0],
  ]);
  const homeOccupancy = new Map<string, number>();
  const workplaceOccupancy = new Map<string, number>();
  const serviceOccupancy = new Map<string, number>();
  for (const building of snapshot.buildings) {
    if (buildingIds.has(building.id)) fail(`duplicate building id ${building.id}`);
    buildingIds.add(building.id);
    const typeCapacity = capacityByType.get(building.type);
    if (typeCapacity === undefined) fail(`unsupported building type ${building.type}`);
    else capacityByType.set(building.type, typeCapacity + building.capacity);
    if (!Number.isSafeInteger(building.capacity) || building.capacity < 0) {
      fail(`building ${building.id} has invalid capacity`);
    }
    if (building.type === 'service') {
      if (building.footprint.width !== 4 || building.footprint.height !== 4) {
        fail(`service building ${building.id} does not have a 4x4 footprint`);
      }
      if (building.capacity !== 8) fail(`service building ${building.id} does not have capacity 8`);
    }
    if (!isExteriorEntrance(building.entrance, building.footprint)) {
      fail(`building ${building.id} entrance is not exterior`);
    }
    for (const cell of footprintCells(building.footprint)) {
      if (!active(snapshot, cell)) fail(`building ${building.id} leaves active chunks`);
      const cellKey = `${String(cell.x)},${String(cell.y)}`;
      if (occupiedCells.has(cellKey)) fail(`building footprints overlap at ${cellKey}`);
      occupiedCells.add(cellKey);
    }
    for (const cell of buildingClearanceZoneCells(building.footprint)) {
      if (!active(snapshot, cell)) fail(`building ${building.id} envelope leaves active chunks`);
      for (const other of snapshot.buildings) {
        if (other.id === building.id) continue;
        if (footprintCells(other.footprint).some(({ x, y }) => x === cell.x && y === cell.y)) {
          fail(`building envelopes overlap at ${String(cell.x)},${String(cell.y)}`);
        }
      }
    }
    if (!active(snapshot, building.entrance)) fail(`building ${building.id} entrance is inactive`);
  }

  const occupancyIds = new Set<string>();
  for (const entry of snapshot.occupancy) {
    if (occupancyIds.has(entry.buildingId)) {
      fail(`duplicate occupancy entry ${entry.buildingId}`);
    }
    occupancyIds.add(entry.buildingId);
    const building = snapshot.buildings.find(({ id }) => id === entry.buildingId);
    if (building === undefined) {
      fail(`occupancy references missing building ${entry.buildingId}`);
      continue;
    }
    if (entry.buildingType !== building.type) {
      fail(`occupancy type mismatch for ${entry.buildingId}`);
    }
    if (
      entry.occupied !== entry.occupancy ||
      entry.capacity !== building.capacity ||
      entry.occupied < 0 ||
      entry.occupied > entry.capacity ||
      entry.available !== entry.capacity - entry.occupied
    ) {
      fail(`occupancy is invalid for ${entry.buildingId}`);
    }
  }
  if (occupancyIds.size !== buildingIds.size) fail('occupancy does not cover buildings');

  const projectIds = new Set<string>();
  const projectWorkerCounts = new Map<string, number>();
  const projectConstructingCounts = new Map<string, number>();
  for (const project of snapshot.constructionProjects) {
    if (projectIds.has(project.id)) fail(`duplicate construction project id ${project.id}`);
    projectIds.add(project.id);
    if (!CONSTRUCTION_PHASE_ORDER.includes(project.phase)) {
      fail(`construction project ${project.id} has invalid phase ${project.phase}`);
    }
    if (project.phaseTicksRemaining < 1 || project.phaseTicksElapsed < 0) {
      fail(`construction project ${project.id} has invalid phase timing`);
    }
    if (
      !Number.isSafeInteger(project.phaseLaborCompleted) ||
      !Number.isSafeInteger(project.phaseLaborRequired) ||
      project.phaseLaborRequired < 1 ||
      project.phaseLaborCompleted < 0 ||
      project.phaseLaborCompleted > project.phaseLaborRequired ||
      !Number.isSafeInteger(project.workerCount) ||
      project.workerCount < 0
    ) {
      fail(`construction project ${project.id} has invalid labor state`);
    }
    if (project.buildingType === 'service') {
      if (project.footprint.width !== 4 || project.footprint.height !== 4) {
        fail(`service project ${project.id} does not have a 4x4 footprint`);
      }
      if (project.capacity !== 8) fail(`service project ${project.id} does not have capacity 8`);
    }
    if (project.stagingCells.length !== 3) {
      fail(`construction project ${project.id} does not have exactly three staging cells`);
    }
    const stagingKeys = new Set<string>();
    for (const staging of project.stagingCells) {
      const stagingKey = `${String(staging.x)},${String(staging.y)}`;
      if (stagingKeys.has(stagingKey)) fail(`construction project ${project.id} repeats staging`);
      stagingKeys.add(stagingKey);
      if (!active(snapshot, staging))
        fail(`construction project ${project.id} staging is inactive`);
      if (occupiedCells.has(stagingKey) || reservedCells.has(stagingKey)) {
        fail(`construction project ${project.id} staging enters a footprint`);
      }
    }
    projectWorkerCounts.set(project.id, 0);
    projectConstructingCounts.set(project.id, 0);
    if (!isExteriorEntrance(project.entrance, project.footprint)) {
      fail(`construction project ${project.id} entrance is not exterior`);
    }
    if (!active(snapshot, project.entrance)) {
      fail(`construction project ${project.id} entrance is inactive`);
    }
    for (const cell of footprintCells(project.footprint)) {
      if (!active(snapshot, cell)) fail(`construction project ${project.id} leaves active chunks`);
      const cellKey = `${String(cell.x)},${String(cell.y)}`;
      if (occupiedCells.has(cellKey))
        fail(`construction project overlaps a building at ${cellKey}`);
      if (reservedCells.has(cellKey)) fail(`construction projects overlap at ${cellKey}`);
      reservedCells.add(cellKey);
    }
    for (const cell of buildingClearanceZoneCells(project.footprint)) {
      if (!active(snapshot, cell))
        fail(`construction project ${project.id} envelope leaves active chunks`);
      if (occupiedCells.has(`${String(cell.x)},${String(cell.y)}`)) {
        fail(`construction project ${project.id} envelope overlaps a building`);
      }
    }
    if (occupiedCells.has(`${String(project.entrance.x)},${String(project.entrance.y)}`)) {
      fail(`construction project ${project.id} entrance is blocked`);
    }
  }

  const demandKeys = new Set<string>();
  for (const chunk of snapshot.demand.chunks) {
    demandKeys.add(chunk.key);
    if (!activeKeys.has(chunk.key)) fail(`demand summary is inactive ${chunk.key}`);
    if (chunk.cellCount !== snapshot.chunkSize * snapshot.chunkSize) {
      fail(`demand summary cell count is invalid for ${chunk.key}`);
    }
    for (const value of Object.values(chunk.totals)) {
      if (!Number.isFinite(value) || value < 0 || value > snapshot.chunkSize * snapshot.chunkSize) {
        fail(`demand total is invalid for ${chunk.key}`);
      }
    }
  }
  if (demandKeys.size !== activeKeys.size) fail('demand summaries do not cover active chunks');
  for (const value of Object.values(snapshot.demand.totals)) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > snapshot.activeChunkCount * snapshot.chunkSize * snapshot.chunkSize
    ) {
      fail('global demand total is invalid');
    }
  }

  let previousTrafficKey: string | undefined;
  let currentWindowTrafficEvents = 0;
  for (const edge of snapshot.traffic) {
    if (previousTrafficKey !== undefined && compareStrings(edge.key, previousTrafficKey) <= 0) {
      fail('traffic edges are not stably ordered');
    }
    previousTrafficKey = edge.key;
    try {
      const canonical = canonicalTrafficEdge(edge.a, edge.b);
      if (canonical.key !== edge.key) fail(`traffic edge key mismatch ${edge.key}`);
    } catch {
      fail(`traffic edge ${edge.key} is invalid`);
    }
    if (
      !Number.isSafeInteger(edge.aToB) ||
      !Number.isSafeInteger(edge.bToA) ||
      !Number.isSafeInteger(edge.total) ||
      edge.aToB < 0 ||
      edge.bToA < 0 ||
      edge.total < 1 ||
      edge.aToB + edge.bToA !== edge.total
    ) {
      fail(`traffic edge ${edge.key} has invalid counts`);
    }
    currentWindowTrafficEvents += edge.total;
  }
  if (snapshot.structural.activeTrafficEdges !== snapshot.traffic.length) {
    fail('active traffic edge count mismatch');
  }
  if (
    snapshot.structural.trafficTraversalEventsRecorded !==
    currentWindowTrafficEvents + snapshot.structural.trafficExpiredTraversalEvents
  ) {
    fail('traffic traversal counts do not reconcile');
  }
  if (snapshot.structural.trafficPeakActiveEdges < snapshot.structural.activeTrafficEdges) {
    fail('traffic peak active edge count is below the active count');
  }
  if (
    snapshot.structural.trafficExpiredTraversalEvents < 0 ||
    snapshot.structural.trafficExpiredBuckets < 0
  ) {
    fail('traffic expiry counters are negative');
  }
  if (
    snapshot.structural.trafficTraversalEventsRecorded !==
    snapshot.structural.movementCommittedMoves
  ) {
    fail('traffic traversal count does not equal committed movement count');
  }
  if (
    snapshot.structural.movementProposals !==
    snapshot.structural.movementCommittedMoves + snapshot.structural.movementBlockedMoves
  ) {
    fail('movement proposals do not reconcile with committed and blocked moves');
  }
  if (
    snapshot.structural.movementTargetConflicts > snapshot.structural.movementBlockedMoves ||
    snapshot.structural.movementDependencyBlocks > snapshot.structural.movementBlockedMoves ||
    snapshot.structural.movementOrdinarySwapsRejected > snapshot.structural.movementBlockedMoves
  ) {
    fail('movement conflict counters exceed blocked moves');
  }

  const citizenIds = new Set<string>();
  const movingCells = new Set<string>();
  const validActivities = new Set([
    'idle',
    'home',
    'commuting-to-work',
    'work',
    'commuting-home',
    'commuting-to-service',
    'service',
    'commuting-to-construction',
    'constructing',
  ]);
  for (const citizen of snapshot.citizens) {
    if (citizenIds.has(citizen.id)) fail(`duplicate citizen id ${citizen.id}`);
    citizenIds.add(citizen.id);
    if (!active(snapshot, citizen.position)) fail(`citizen ${citizen.id} is inactive`);
    if (!active(snapshot, citizen.previousPosition)) {
      fail(`citizen ${citizen.id} previous position is inactive`);
    }
    if (
      occupiedCells.has(`${String(citizen.position.x)},${String(citizen.position.y)}`) ||
      reservedCells.has(`${String(citizen.position.x)},${String(citizen.position.y)}`)
    ) {
      fail(`citizen ${citizen.id} occupies a building interior`);
    }
    const home =
      citizen.homeBuildingId === null
        ? undefined
        : snapshot.buildings.find(({ id }) => id === citizen.homeBuildingId);
    const workplace =
      citizen.workplaceBuildingId === null
        ? undefined
        : snapshot.buildings.find(({ id }) => id === citizen.workplaceBuildingId);
    if (citizen.homeBuildingId !== null && home === undefined)
      fail(`citizen ${citizen.id} has no home`);
    else if (home !== undefined) {
      if (home.type !== 'home') fail(`citizen ${citizen.id} home has invalid type`);
      homeOccupancy.set(home.id, (homeOccupancy.get(home.id) ?? 0) + 1);
    }
    if (citizen.workplaceBuildingId !== null && workplace === undefined)
      fail(`citizen ${citizen.id} has no workplace`);
    else if (workplace !== undefined) {
      if (workplace.type !== 'workplace') fail(`citizen ${citizen.id} workplace has invalid type`);
      workplaceOccupancy.set(workplace.id, (workplaceOccupancy.get(workplace.id) ?? 0) + 1);
    }
    if (
      citizen.serviceNeed < 0 ||
      !Number.isSafeInteger(citizen.serviceNeed) ||
      citizen.serviceNeed > 4
    ) {
      fail(`citizen ${citizen.id} has invalid service need`);
    }
    if (!Number.isSafeInteger(citizen.serviceWaitTicks) || citizen.serviceWaitTicks < 0) {
      fail(`citizen ${citizen.id} has invalid service wait state`);
    }
    if (citizen.serviceDestinationBuildingId !== null) {
      const service = snapshot.buildings.find(
        ({ id }) => id === citizen.serviceDestinationBuildingId,
      );
      if (service?.type !== 'service') {
        fail(`citizen ${citizen.id} has invalid service destination`);
      } else {
        serviceOccupancy.set(service.id, (serviceOccupancy.get(service.id) ?? 0) + 1);
        if (
          (citizen.activity === 'service' || citizen.activity === 'commuting-to-service') &&
          !isExteriorEntrance(service.entrance, service.footprint)
        ) {
          fail(`citizen ${citizen.id} service destination has invalid entrance`);
        }
      }
    } else if (citizen.activity === 'service' || citizen.activity === 'commuting-to-service') {
      fail(`citizen ${citizen.id} has a service activity without a destination`);
    }
    if (!validActivities.has(citizen.activity)) fail(`citizen ${citizen.id} has invalid activity`);
    if (
      !Number.isSafeInteger(citizen.activityTicksRemaining) ||
      citizen.activityTicksRemaining < 0
    ) {
      fail(`citizen ${citizen.id} has invalid schedule state`);
    }
    if (!Number.isSafeInteger(citizen.waitTicks) || citizen.waitTicks < 0) {
      fail(`citizen ${citizen.id} has invalid wait state`);
    }
    if (
      citizen.activity === 'commuting-to-work' ||
      citizen.activity === 'commuting-home' ||
      citizen.activity === 'commuting-to-service' ||
      citizen.activity === 'commuting-to-construction' ||
      citizen.activity === 'constructing'
    ) {
      const movingKey = `${String(citizen.position.x)},${String(citizen.position.y)}`;
      if (movingCells.has(movingKey)) fail(`duplicate moving occupancy at ${movingKey}`);
      movingCells.add(movingKey);
    }
    if (citizen.constructionProjectId !== null) {
      const project = snapshot.constructionProjects.find(
        ({ id }) => id === citizen.constructionProjectId,
      );
      if (project === undefined) {
        fail(`citizen ${citizen.id} references missing construction project`);
      } else {
        projectWorkerCounts.set(project.id, (projectWorkerCounts.get(project.id) ?? 0) + 1);
        const constructionStagingCell = citizen.constructionStagingCell;
        if (constructionStagingCell === null) {
          fail(`citizen ${citizen.id} has no construction staging assignment`);
        } else if (
          !project.stagingCells.some(
            (cell) => cell.x === constructionStagingCell.x && cell.y === constructionStagingCell.y,
          )
        ) {
          fail(`citizen ${citizen.id} has an invalid construction staging assignment`);
        }
        if (citizen.activity === 'constructing') {
          projectConstructingCounts.set(
            project.id,
            (projectConstructingCounts.get(project.id) ?? 0) + 1,
          );
        }
      }
    } else if (
      citizen.constructionStagingCell !== null ||
      citizen.resumeDestinationBuildingId !== null
    ) {
      fail(`citizen ${citizen.id} has orphaned construction assignment state`);
    }
    if (
      !Number.isSafeInteger(citizen.routeIndex) ||
      citizen.routeIndex < 0 ||
      (citizen.route.length === 0
        ? citizen.routeIndex !== 0
        : citizen.routeIndex >= citizen.route.length)
    ) {
      fail(`citizen ${citizen.id} route index is invalid`);
    }
    for (let index = 0; index < citizen.route.length; index += 1) {
      const position = citizen.route[index];
      if (position === undefined) continue;
      if (!active(snapshot, position)) fail(`citizen ${citizen.id} route leaves active chunks`);
      if (
        occupiedCells.has(`${String(position.x)},${String(position.y)}`) ||
        reservedCells.has(`${String(position.x)},${String(position.y)}`)
      ) {
        fail(`citizen ${citizen.id} route enters a building interior`);
      }
      const previous = citizen.route[index - 1];
      if (previous !== undefined && !adjacent(previous, position)) {
        fail(`citizen ${citizen.id} route is non-adjacent`);
      }
    }
  }
  for (const building of snapshot.buildings) {
    const occupied =
      building.type === 'home'
        ? (homeOccupancy.get(building.id) ?? 0)
        : building.type === 'workplace'
          ? (workplaceOccupancy.get(building.id) ?? 0)
          : (serviceOccupancy.get(building.id) ?? 0);
    if (occupied > building.capacity) fail(`building ${building.id} exceeds capacity`);
  }
  for (const project of snapshot.constructionProjects) {
    const workerCount = projectWorkerCounts.get(project.id) ?? 0;
    const constructingCount = projectConstructingCounts.get(project.id) ?? 0;
    if (workerCount !== project.workerCount) {
      fail(`construction project ${project.id} worker count mismatch`);
    }
    if (project.paused !== (constructingCount === 0)) {
      fail(`construction project ${project.id} paused state mismatch`);
    }
  }
  if (!Number.isSafeInteger(snapshot.populationCap) || snapshot.populationCap < 0) {
    fail('population cap is invalid');
  } else if (snapshot.citizens.length > snapshot.populationCap) {
    fail('population cap is exceeded');
  }
  for (const [name, value] of Object.entries(snapshot.metrics)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${name} metric is invalid`);
  }
  if (
    !Number.isFinite(snapshot.averageTripDurationTicks) ||
    snapshot.averageTripDurationTicks < 0
  ) {
    fail('average trip duration is invalid');
  }
  if (!Number.isFinite(snapshot.data) || snapshot.data < 0) fail('Data is invalid');
  if (snapshot.completedTrips < 0 || snapshot.completedActivities < 0) {
    fail('completed counters are negative');
  }
  if (
    snapshot.completedActivities !==
    snapshot.completedWorkActivities + snapshot.completedServiceActivities
  ) {
    fail('completed activity counters do not reconcile');
  }
  for (const [name, value] of Object.entries({
    completedWorkActivities: snapshot.completedWorkActivities,
    completedServiceActivities: snapshot.completedServiceActivities,
    serviceTrips: snapshot.serviceTrips,
    serviceUses: snapshot.serviceUses,
    failedServiceDestinationAttempts: snapshot.failedServiceDestinationAttempts,
    serviceWaitTicks: snapshot.serviceWaitTicks,
    workData: snapshot.dataBySource.work,
    serviceData: snapshot.dataBySource.service,
  })) {
    if (!Number.isSafeInteger(value) && name.endsWith('Activities')) {
      fail(`${name} is not an integer`);
    }
    if (!Number.isFinite(value) || value < 0) fail(`${name} is invalid`);
  }
  if (
    snapshot.dataGeneratedThisTick !==
    snapshot.dataGeneratedThisTickBySource.work + snapshot.dataGeneratedThisTickBySource.service
  ) {
    fail('per-tick Data source counters do not reconcile');
  }
  if (
    snapshot.servicesCore.purchased !== snapshot.core.servicesCore.purchased ||
    snapshot.servicesCore.unlocked !== snapshot.core.servicesCore.unlocked ||
    snapshot.servicesCore.focus !== snapshot.core.servicesCore.focus ||
    snapshot.servicesCore.selectedFocus !== snapshot.core.servicesCore.selectedFocus
  ) {
    fail('core and services-core snapshot views diverge');
  }
  if (snapshot.servicesCore.cost !== 50) fail('Services Core cost is not 50');
  if (snapshot.servicesCore.purchased !== snapshot.servicesCore.unlocked) {
    fail('Services Core purchase and unlock state diverge');
  }
  if (
    snapshot.structural.constructionProjectsCompleted + snapshot.constructionProjects.length !==
    snapshot.structural.constructionProjectsStarted
  ) {
    fail('construction project counts do not reconcile');
  }
  const job = snapshot.developmentJob;
  if (job.anchorChecksThisTick > 512) fail('development anchor budget exceeded');
  if (job.preliminaryCandidatesRetained > 32) fail('development preliminary cap exceeded');
  if (job.finalistsValidatedThisTick > 4) fail('development finalist budget exceeded');
  if (snapshot.structural.developmentPeakAnchorChecksPerTick > 512) {
    fail('development peak anchor budget exceeded');
  }
  if (snapshot.structural.developmentPeakFinalistValidationsPerTick > 4) {
    fail('development peak finalist budget exceeded');
  }
  return failures;
}

export function runBalance(options: BalanceOptions): BalanceSummary {
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 0) {
    throw new Error('ticks must be a non-negative safe integer.');
  }
  const scenario = options.scenario ?? 'empty-city-opening';
  const scenarioConfig = getBalanceScenarioConfig(scenario);
  const scheduledCommands = [
    ...getBalanceScenarioCommands(scenario),
    ...(options.commands ?? []),
  ].map((scheduled, index) => ({ ...scheduled, order: index }));
  const scheduledActivations = [
    ...getBalanceScenarioActivations(scenario),
    ...(options.activations ?? []),
  ].map((scheduled, index) => ({ ...scheduled, order: index }));
  const scheduledCorePurchases = [
    ...getBalanceScenarioCorePurchases(scenario),
    ...(options.corePurchases ?? []),
  ].map((scheduled, index) => ({ ...scheduled, order: index }));
  const scheduledManualData = [
    ...getBalanceScenarioManualData(scenario),
    ...(options.manualData ?? []),
  ].map((scheduled, index) => ({ ...scheduled, order: index }));
  for (const scheduled of [
    ...scheduledCommands,
    ...scheduledActivations,
    ...scheduledCorePurchases,
    ...scheduledManualData,
  ]) {
    if (!Number.isSafeInteger(scheduled.tick) || scheduled.tick < 0) {
      throw new Error(
        `Schedule tick must be a non-negative safe integer; received ${String(scheduled.tick)}.`,
      );
    }
  }
  scheduledCommands.sort((left, right) => left.tick - right.tick || left.order - right.order);
  scheduledActivations.sort((left, right) => left.tick - right.tick || left.order - right.order);
  scheduledCorePurchases.sort((left, right) => left.tick - right.tick || left.order - right.order);
  scheduledManualData.sort((left, right) => left.tick - right.tick || left.order - right.order);
  const simulation = createSimulation({
    ...scenarioConfig,
    seed: options.seed,
    ...(options.citizenCount === undefined ? {} : { citizenCount: options.citizenCount }),
    ...(options.initialPopulation === undefined
      ? {}
      : { initialPopulation: options.initialPopulation }),
    ...(options.populationCap === undefined ? {} : { populationCap: options.populationCap }),
    ...(options.populationGrowthCadenceTicks === undefined
      ? {}
      : { populationGrowthCadenceTicks: options.populationGrowthCadenceTicks }),
  });
  const invariantFailures = new Set<string>();
  const commandResults: BalanceCommandResult[] = [];
  const activationResults: BalanceActivationResult[] = [];
  const corePurchaseResults: BalanceCorePurchaseResult[] = [];
  const manualDataResults: BalanceManualDataResult[] = [];
  let observedWaitTicks = 0;
  let observedWaitSamples = 0;
  let observedMaxWaitTicks = 0;
  let nextScheduledCommand = 0;
  let nextScheduledActivation = 0;
  let nextScheduledCorePurchase = 0;
  let nextScheduledManualData = 0;
  const applyScheduled = (): void => {
    const currentTick = simulation.getSnapshot().tick;
    // Equal-tick commands are applied in the fixed order activation, core purchase,
    // manual Data, then district seed. Each list preserves its declared order.
    while (nextScheduledActivation < scheduledActivations.length) {
      const scheduled = scheduledActivations[nextScheduledActivation];
      if (scheduled === undefined || scheduled.tick > currentTick) break;
      const command = { ...scheduled.command };
      activationResults.push({
        tick: currentTick,
        command,
        result: simulation.activateChunk(command),
      });
      nextScheduledActivation += 1;
    }
    while (nextScheduledCorePurchase < scheduledCorePurchases.length) {
      const scheduled = scheduledCorePurchases[nextScheduledCorePurchase];
      if (scheduled === undefined || scheduled.tick > currentTick) break;
      const command = { ...scheduled.command };
      corePurchaseResults.push({
        tick: currentTick,
        command,
        info: simulation.previewCorePurchase(command),
        result: simulation.purchaseCore(command),
      });
      nextScheduledCorePurchase += 1;
    }
    while (nextScheduledManualData < scheduledManualData.length) {
      const scheduled = scheduledManualData[nextScheduledManualData];
      if (scheduled === undefined || scheduled.tick > currentTick) break;
      manualDataResults.push({ tick: currentTick, result: simulation.gatherManualData() });
      nextScheduledManualData += 1;
    }
    while (nextScheduledCommand < scheduledCommands.length) {
      const scheduled = scheduledCommands[nextScheduledCommand];
      if (scheduled === undefined || scheduled.tick > currentTick) break;
      const command = { ...scheduled.command, position: { ...scheduled.command.position } };
      const preview = simulation.getDistrictSeedPlacementInfo(command);
      commandResults.push({
        tick: currentTick,
        command,
        preview,
        result: simulation.placeDistrictSeed(command),
      });
      nextScheduledCommand += 1;
    }
  };
  const recordInvariantFailures = (label: string, snapshot: SimulationSnapshot): void => {
    for (const citizen of snapshot.citizens) {
      observedWaitTicks += citizen.waitTicks;
      observedWaitSamples += 1;
      observedMaxWaitTicks = Math.max(observedMaxWaitTicks, citizen.waitTicks);
    }
    for (const failure of collectInvariantFailures(snapshot))
      invariantFailures.add(`${label}: ${failure}`);
  };
  applyScheduled();
  recordInvariantFailures('initial', simulation.getSnapshot());
  for (let tick = 0; tick < options.ticks; tick += 1) {
    try {
      simulation.step();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      invariantFailures.add(`tick ${String(tick + 1)}: ${message}`);
      break;
    }
    applyScheduled();
    recordInvariantFailures(`tick ${String(tick + 1)}`, simulation.getSnapshot());
  }
  const snapshot = simulation.getSnapshot();
  const directionalTraversals = snapshot.traffic.reduce(
    (total, edge) => total + edge.aToB + edge.bToA,
    0,
  );
  const totalTraversals = snapshot.traffic.reduce((total, edge) => total + edge.total, 0);
  const accessUsage: BalanceAccessUsage[] = [];
  for (const building of snapshot.buildings) {
    const counts = new Map<string, number>();
    for (const cell of building.accessCells ?? [])
      counts.set(`${String(cell.x)},${String(cell.y)}`, 0);
    for (const edge of snapshot.traffic) {
      for (const endpoint of [edge.a, edge.b]) {
        const key = `${String(endpoint.x)},${String(endpoint.y)}`;
        if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + edge.total);
      }
    }
    for (const cell of building.accessCells ?? []) {
      const key = `${String(cell.x)},${String(cell.y)}`;
      const count = counts.get(key) ?? 0;
      if (count > 0) accessUsage.push({ buildingId: building.id, cell: { ...cell }, count });
    }
  }
  accessUsage.sort(
    (left, right) =>
      left.buildingId.localeCompare(right.buildingId) ||
      left.cell.y - right.cell.y ||
      left.cell.x - right.cell.x,
  );
  const assignments = snapshot.citizens
    .map(({ id, homeBuildingId, workplaceBuildingId, activity }) => ({
      id,
      homeBuildingId,
      workplaceBuildingId,
      activity,
    }))
    .map(({ id, homeBuildingId, workplaceBuildingId, activity }) => ({
      citizenId: id,
      homeBuildingId,
      workplaceBuildingId,
      activity,
    }));
  const movement: BalanceMovementSummary = {
    proposals: snapshot.structural.movementProposals,
    committedMoves: snapshot.structural.movementCommittedMoves,
    blockedMoves: snapshot.structural.movementBlockedMoves,
    averageWaitTicks: observedWaitSamples === 0 ? 0 : observedWaitTicks / observedWaitSamples,
    maxWaitTicks: observedMaxWaitTicks,
    targetConflicts: snapshot.structural.movementTargetConflicts,
    dependencyBlocks: snapshot.structural.movementDependencyBlocks,
    cyclesCommitted: snapshot.structural.movementCyclesCommitted,
    ordinarySwapsRejected: snapshot.structural.movementOrdinarySwapsRejected,
    replansAttempted: snapshot.structural.movementReplansAttempted,
    replansSucceeded: snapshot.structural.movementReplansSucceeded,
    replansUnchanged: snapshot.structural.movementReplansUnchanged,
    emergencySwaps: snapshot.structural.movementDeadlockRecoveries,
    criticalPriorityWins: snapshot.structural.movementCriticalPriorityWins,
  };
  const construction: BalanceConstructionSummary = {
    assignmentsOffered: snapshot.structural.constructionAssignmentsOffered,
    assignmentsAccepted: snapshot.structural.constructionAssignmentsAccepted,
    constructionCommutes: snapshot.structural.constructionCommutes,
    workerArrivals: snapshot.structural.constructionWorkerArrivals,
    laborUnits: snapshot.structural.constructionLaborUnits,
    pausedProjectTicks: snapshot.structural.constructionPausedProjectTicks,
    phaseCompletions: snapshot.structural.constructionPhaseCompletions,
    workerReleases: snapshot.structural.constructionWorkerReleases,
    criticalPromotions: snapshot.structural.constructionCriticalPromotions,
    criticalClears: snapshot.structural.constructionCriticalClears,
    criticalNoEligibleWorkerTicks: snapshot.structural.constructionCriticalNoEligibleWorkerTicks,
    criticalConflictWins: snapshot.structural.constructionCriticalConflictWins,
  };
  return {
    scenario,
    seed: options.seed,
    ticks: options.ticks,
    citizenCount: snapshot.citizens.length,
    populationCap: snapshot.populationCap,
    populationGrowthCadenceTicks: snapshot.populationGrowthCadenceTicks,
    completedTrips: snapshot.completedTrips,
    completedActivities: snapshot.completedActivities,
    completedWorkActivities: snapshot.completedWorkActivities,
    completedServiceActivities: snapshot.completedServiceActivities,
    serviceTrips: snapshot.serviceTrips,
    serviceUses: snapshot.serviceUses,
    failedServiceDestinationAttempts: snapshot.failedServiceDestinationAttempts,
    serviceWaitTicks: snapshot.serviceWaitTicks,
    data: snapshot.data,
    dataGeneratedThisTick: snapshot.dataGeneratedThisTick,
    dataGeneratedThisTickBySource: snapshot.dataGeneratedThisTickBySource,
    dataBySource: snapshot.dataBySource,
    core: snapshot.core,
    servicesCore: snapshot.servicesCore,
    researchFocus: snapshot.researchFocus,
    averageTripDurationTicks: snapshot.averageTripDurationTicks,
    metrics: snapshot.metrics,
    demandTotals: snapshot.demand.totals,
    seeds: snapshot.seeds,
    activeChunkCount: snapshot.activeChunkCount,
    movement,
    construction,
    traffic: snapshot.traffic,
    activeTrafficEdges: snapshot.structural.activeTrafficEdges,
    directionalTraversals,
    totalTraversals,
    trafficTraversalEventsRecorded: snapshot.structural.trafficTraversalEventsRecorded,
    expiredTraversalEvents: snapshot.structural.trafficExpiredTraversalEvents,
    peakActiveEdges: snapshot.structural.trafficPeakActiveEdges,
    structuralCounters: snapshot.structural,
    snapshotChunkSummaries: snapshot.structural.snapshotChunkSummaries,
    snapshotTrafficSummaries: snapshot.traffic.length,
    commandResults,
    activationResults,
    corePurchaseResults,
    manualDataResults,
    assignments,
    accessUsage,
    buildingCount: snapshot.buildings.length,
    homeCount: snapshot.buildings.filter((building) => building.type === 'home').length,
    workplaceCount: snapshot.buildings.filter((building) => building.type === 'workplace').length,
    serviceCount: snapshot.buildings.filter((building) => building.type === 'service').length,
    activeConstructionProjects: snapshot.constructionProjects.length,
    constructionProjectsStarted: snapshot.structural.constructionProjectsStarted,
    constructionProjectsCompleted: snapshot.structural.constructionProjectsCompleted,
    developmentEvaluations: snapshot.structural.developmentEvaluations,
    developmentJob: snapshot.developmentJob,
    invariantFailures: [...invariantFailures],
    determinismHash: simulation.getDeterminismHash(),
  };
}
