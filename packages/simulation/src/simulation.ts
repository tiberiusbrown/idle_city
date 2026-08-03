import {
  orthogonalDistance,
  positionsEqual,
  squareDistance,
  stableHash,
  type ChunkCoordinate,
  type GridPosition,
} from '@idle-city/shared';
import {
  adjacentChunks,
  chunkCoordinateForPosition,
  chunkKey,
  compareChunks,
  createChunkSpatialStore,
  DEFAULT_CHUNK_SIZE,
  enumerateChunkRegion,
  validateChunkSize,
} from './chunks';
import {
  getDistrictSeedCost,
  isDistrictSeedKindUnlocked,
  SERVICES_CORE_COST,
  SERVICES_CORE_MINIMUM_POPULATION,
  SERVICES_CORE_MINIMUM_WORK_ACTIVITIES,
} from './balance-rules';
import {
  compareConstructionAssignments,
  constructionPhaseLaborRequired,
  constructionPhaseMaxWorkers,
  nextConstructionPhase,
  validateConstructionPhaseDurations,
  type ConstructionAssignmentCandidate,
} from './construction';
import { calculateDemandChunk } from './demand';
import {
  compareDevelopmentCandidates,
  DEVELOPMENT_BUILDING_TYPE_ORDER,
  scoreDevelopmentCandidate,
} from './developer';
import { calculateDistrictSeedInfluence } from './district-seeds';
import {
  districtSeedInfluenceRadius,
  enumerateDistrictSeedInfluenceCells,
  getDistrictSeedDefinition,
} from './district-seeds';
import {
  buildingFootprint,
  completedBuildingAccessCells,
  buildingClearanceZone,
  buildingClearanceZoneCells,
  footprintCells,
  isExteriorEntrance,
  isInsideFootprint,
  selectProjectStagingCells,
  stagingCapableClearanceZoneCells,
} from './footprints';
import { findGridPathBetweenSets, findGridPathDetailed } from './pathfinding';
import { findNearestCompatiblePair } from './population';
import { SeededRandom } from './random';
import {
  SERVICE_BUILDING_CAPACITY,
  SERVICE_NEED_MAX,
  SERVICE_NEED_THRESHOLD,
  SERVICE_USE_DURATION_TICKS,
  scoreServiceDestination,
  selectServiceDestination,
  type ServiceDestinationCandidate,
} from './services';
import { createTrafficTelemetry, DEFAULT_TRAFFIC_HISTORY_WINDOW_TICKS } from './traffic';
import {
  buildMovementProposals,
  compareMovementProposals,
  findDirectMovementSwapPairs,
  MOVEMENT_DEADLOCK_RECOVERY_BLOCKED_TICKS,
  isMovementDeadlockRecoveryDue,
  isMovementReplanDue,
  resolveMovementReservations,
  replanMovementRoute,
  type MovementCandidate,
  type MovementSwapPair,
} from './movement';
import type {
  ActivateChunkCommand,
  ActiveChunkSnapshot,
  Building,
  BuildingOccupancy,
  BuildingType,
  ChunkActivationResult,
  ChunkRegion,
  CitizenActivity,
  CitizenSnapshot,
  CityMetrics,
  ConstructionPhase,
  ConstructionProject,
  CommandRejectionReason,
  CommandResult,
  CoreProtocol,
  CorePurchaseRejectionReason,
  CorePurchaseInfo,
  CorePurchaseResult,
  CoreState,
  DemandCell,
  DemandChunkSnapshot,
  DemandRegionQuery,
  DemandRegionSnapshot,
  DemandTotals,
  DevelopmentCandidate,
  DevelopmentJobProgress,
  DevelopmentJobStage,
  DistrictSeed,
  DistrictSeedDefinition,
  DistrictSeedKind,
  DistrictSeedPlacementInfo,
  DistrictSeedPlacementPreview,
  InitialCitizenConfig,
  PlaceDistrictSeedCommand,
  Simulation,
  SimulationConfig,
  SimulationSnapshot,
  SimulationStructuralCounters,
  ResearchFocus,
  ServicesCoreState,
  PurchaseCoreCommand,
} from './types';

interface CitizenState {
  readonly id: string;
  position: GridPosition;
  previousPosition: GridPosition;
  homeBuildingId: string | null;
  workplaceBuildingId: string | null;
  activity: CitizenActivity;
  activityTicksRemaining: number;
  departurePending: boolean;
  route: GridPosition[];
  routeIndex: number;
  tripStartedTick: number | null;
  waitTicks: number;
  serviceNeed: number;
  serviceDestinationBuildingId: string | null;
  serviceDestinationReason: string | null;
  serviceWaitTicks: number;
  constructionProjectId: string | null;
  constructionStagingCell: GridPosition | null;
  constructionCadenceTicks: number;
  resumeDestinationBuildingId: string | null;
  resumeActivity: 'commuting-to-work' | 'commuting-home' | null;
  criticalBuilderProjectId: string | null;
  criticalBuilderReason: string | null;
}

interface DemandChunkState {
  readonly coordinate: ChunkCoordinate;
  readonly key: string;
  values: Float64Array | undefined;
  totals: DemandTotals;
  revision: number;
  dirty: boolean;
}

interface ConstructionProjectState {
  readonly id: string;
  readonly buildingType: BuildingType;
  readonly footprint: Building['footprint'];
  readonly entrance: GridPosition;
  readonly capacity: number;
  phase: ConstructionPhase;
  phaseLaborCompleted: number;
  phaseLaborRequired: number;
  phaseWorkerCap: number;
  paused: boolean;
  phaseTicksRemaining: number;
  phaseTicksElapsed: number;
  totalTicksElapsed: number;
  ticksSinceLastLabor: number;
  criticalBuilderId: string | null;
  criticalBuilderReason: string | null;
  readonly startedTick: number;
  readonly score: number;
  readonly primaryReason: ConstructionProject['primaryReason'];
  readonly seedInfluence: number;
  readonly spatialFactor: number;
  readonly expectedAccessImprovement: number;
  readonly clearanceZone: Building['footprint'];
  readonly stagingCells: GridPosition[];
}

interface ConstructionRouteOffer {
  readonly candidate: ConstructionAssignmentCandidate;
  readonly citizenId: string;
  readonly projectId: string;
  readonly stagingIndex: number;
  readonly route: readonly GridPosition[];
}

interface DevelopmentJobState {
  readonly stateVersion: number;
  stage: Exclude<DevelopmentJobStage, 'idle' | 'complete' | 'superseded'>;
  readonly relevantChunks: ChunkCoordinate[];
  buildingTypeIndex: number;
  chunkIndex: number;
  localX: number;
  localY: number;
  preliminary: DevelopmentCandidate[];
  finalistIndex: number;
  totalAnchorChecks: number;
  totalFinalistsValidated: number;
  anchorChecksThisTick: number;
  finalistsValidatedThisTick: number;
}

interface DeadlockPairState {
  readonly key: string;
  readonly leftId: string;
  readonly rightId: string;
  readonly leftFrom: GridPosition;
  readonly leftTo: GridPosition;
  readonly rightFrom: GridPosition;
  readonly rightTo: GridPosition;
  blockedTicks: number;
}

type DistrictSeedPlacementValidation =
  | {
      readonly accepted: true;
      readonly kind: DistrictSeedKind;
      readonly position: GridPosition;
      readonly cost: number;
    }
  | {
      readonly accepted: false;
      readonly reason: CommandRejectionReason;
    };

const defaults = {
  chunkSize: DEFAULT_CHUNK_SIZE,
  initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 } as const,
  activeChunkLimit: 256,
  demandQueryMaxCells: 4_096,
  seed: 1,
  citizenCount: 1,
  activityDurationTicks: 3,
  populationCap: 100,
  populationGrowthCadenceTicks: 20,
  startingData: 0,
  developmentEvaluationIntervalTicks: 20,
  developmentMinimumScore: 0.2,
  developmentCandidateSnapshotLimit: 64,
  developmentHomeCapacity: 1,
  developmentWorkplaceCapacity: 4,
  trafficHistoryWindowTicks: DEFAULT_TRAFFIC_HISTORY_WINDOW_TICKS,
  developmentAnchorCheckBudget: 512,
  developmentPreliminaryCandidateLimit: 32,
  developmentFinalistValidationBudget: 4,
} as const;

const zeroTotals = (): DemandTotals => ({ living: 0, working: 0, services: 0 });

function positiveInteger(name: string, value: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer of at least ${String(minimum)}; received ${String(value)}.`,
    );
  }
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  return positiveInteger(name, value, 0);
}

function nonNegativeNumber(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number; received ${String(value)}.`);
  }
  return value;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function orthogonalTravelDistance(left: GridPosition, right: GridPosition): number {
  return orthogonalDistance(left, right);
}

function roundData(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function dataEfficiency(metrics: CityMetrics): number {
  return 0.5 + (metrics.space + metrics.access + metrics.activity) / 6;
}

function sameMetrics(left: CityMetrics, right: CityMetrics): boolean {
  return (
    left.space === right.space && left.access === right.access && left.activity === right.activity
  );
}

function copyPosition(position: GridPosition): GridPosition {
  return { x: position.x, y: position.y };
}

function copyChunk(chunk: ChunkCoordinate): ChunkCoordinate {
  return { x: chunk.x, y: chunk.y };
}

function copyTotals(totals: DemandTotals): DemandTotals {
  return { living: totals.living, working: totals.working, services: totals.services };
}

function coordinateKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function comparePositions(left: GridPosition, right: GridPosition): number {
  return left.y === right.y ? left.x - right.x : left.y - right.y;
}

function compareCitizenIds(left: CitizenState, right: CitizenState): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function distanceToRect(position: GridPosition, rect: Building['footprint']): number {
  const dx =
    position.x < rect.x
      ? rect.x - position.x
      : position.x >= rect.x + rect.width
        ? position.x - (rect.x + rect.width - 1)
        : 0;
  const dy =
    position.y < rect.y
      ? rect.y - position.y
      : position.y >= rect.y + rect.height
        ? position.y - (rect.y + rect.height - 1)
        : 0;
  return Math.max(dx, dy);
}

function normalizedDistance(distance: number, maximum: number): number {
  return clampUnit(1 - distance / Math.max(1, maximum));
}

function resolveRegion(config: SimulationConfig): ChunkRegion {
  const region =
    config.initialActiveRegion ?? config.initialChunkRegion ?? defaults.initialChunkRegion;
  return {
    minX: region.minX,
    minY: region.minY,
    width: region.width,
    height: region.height,
  };
}

function buildingCellIndex(index: number, kind: 'living' | 'working' | 'services'): number {
  const offset = kind === 'living' ? 0 : kind === 'working' ? 1 : 2;
  return index * 3 + offset;
}

export function createSimulation(config: SimulationConfig = {}): Simulation {
  const chunkSize = validateChunkSize(config.chunkSize ?? defaults.chunkSize);
  const activeChunkLimit = positiveInteger(
    'activeChunkLimit',
    config.activeChunkLimit ?? defaults.activeChunkLimit,
  );
  const demandQueryMaxCells = positiveInteger(
    'demandQueryMaxCells',
    config.demandQueryMaxCells ?? defaults.demandQueryMaxCells,
  );
  const demandInfluenceRadius = positiveInteger(
    'demandInfluenceRadius',
    config.demandInfluenceRadius ?? chunkSize * 2,
  );
  const pathSearchBudget = positiveInteger(
    'pathSearchBudget',
    config.pathSearchBudget ?? Math.max(10_000, chunkSize * chunkSize),
  );
  const trafficHistoryWindowTicks = positiveInteger(
    'trafficHistoryWindowTicks',
    config.trafficHistoryWindowTicks ??
      config.trafficWindowTicks ??
      defaults.trafficHistoryWindowTicks,
  );
  const region = resolveRegion(config);
  const initialMinX = region.minX * chunkSize;
  const initialMinY = region.minY * chunkSize;
  const initialChunkMap = new Map(
    enumerateChunkRegion(region).map((chunk) => [chunkKey(chunk), chunk]),
  );
  const initialChunks = [...initialChunkMap.values()].sort(compareChunks);
  if (initialChunks.length > activeChunkLimit) {
    throw new Error('Initial active chunk region exceeds activeChunkLimit.');
  }
  const spatial = createChunkSpatialStore(chunkSize);
  for (const chunk of initialChunks) spatial.activate(chunk);

  const seed = config.seed ?? defaults.seed;
  const requestedCitizenCount = nonNegativeInteger(
    'citizenCount',
    config.initialPopulation ?? config.citizenCount ?? defaults.citizenCount,
  );
  const activityDurationTicks = positiveInteger(
    'activityDurationTicks',
    config.activityDurationTicks ?? defaults.activityDurationTicks,
  );
  const populationCap = nonNegativeInteger(
    'populationCap',
    config.populationCap ??
      config.maxPopulation ??
      Math.max(requestedCitizenCount, defaults.populationCap),
  );
  const populationGrowthCadenceTicks = positiveInteger(
    'populationGrowthCadenceTicks',
    config.populationGrowthCadenceTicks ??
      config.populationGrowthIntervalTicks ??
      defaults.populationGrowthCadenceTicks,
  );
  if (config.housingCapacity !== undefined && config.housingCapacity !== 1) {
    throw new Error('housingCapacity is fixed at 1.');
  }
  if (config.workplaceCapacity !== undefined && config.workplaceCapacity !== 4) {
    throw new Error('workplaceCapacity is fixed at 4.');
  }
  const startingData = roundData(
    nonNegativeNumber('startingData', config.startingData ?? defaults.startingData),
  );
  const developmentEvaluationIntervalTicks = positiveInteger(
    'developmentEvaluationIntervalTicks',
    config.developmentEvaluationIntervalTicks ?? defaults.developmentEvaluationIntervalTicks,
  );
  const developmentMinimumScore = nonNegativeNumber(
    'developmentMinimumScore',
    config.developmentMinimumScore ?? defaults.developmentMinimumScore,
  );
  if (developmentMinimumScore > 1) {
    throw new Error(
      `developmentMinimumScore must be at most 1; received ${String(developmentMinimumScore)}.`,
    );
  }
  const developmentCandidateSnapshotLimit = positiveInteger(
    'developmentCandidateSnapshotLimit',
    config.developmentCandidateSnapshotLimit ?? defaults.developmentCandidateSnapshotLimit,
  );
  if (config.developmentHomeCapacity !== undefined && config.developmentHomeCapacity !== 1) {
    throw new Error('developmentHomeCapacity is fixed at 1.');
  }
  if (
    config.developmentWorkplaceCapacity !== undefined &&
    config.developmentWorkplaceCapacity !== 4
  ) {
    throw new Error('developmentWorkplaceCapacity is fixed at 4.');
  }
  const developmentHomeCapacity = 1;
  const developmentWorkplaceCapacity = 4;
  const constructionPhaseDurations = validateConstructionPhaseDurations(
    config.constructionPhaseDurations,
  );
  const random = new SeededRandom(seed);
  const traffic = createTrafficTelemetry({ historyWindowTicks: trafficHistoryWindowTicks });

  const buildings: Building[] = [];
  const buildingsById = new Map<string, Building>();
  const initialPopulation =
    config.initialCitizens !== undefined || config.initialBuildings !== undefined
      ? (config.initialCitizens?.length ?? 0)
      : Math.min(requestedCitizenCount, populationCap);
  if (initialPopulation > populationCap) {
    throw new Error('Initial citizen fixture exceeds populationCap.');
  }
  const activeCells = [...initialChunks].flatMap((chunk) => {
    const originX = chunk.x * chunkSize;
    const originY = chunk.y * chunkSize;
    return Array.from({ length: chunkSize * chunkSize }, (_, index) => ({
      x: originX + (index % chunkSize),
      y: originY + Math.floor(index / chunkSize),
    }));
  });
  const centerX = (region.minX + (region.width - 1) / 2) * chunkSize + (chunkSize - 1) / 2;
  const centerY = (region.minY + (region.height - 1) / 2) * chunkSize + (chunkSize - 1) / 2;
  activeCells.sort(
    (left, right) =>
      Math.abs(left.x - centerX) +
        Math.abs(left.y - centerY) -
        (Math.abs(right.x - centerX) + Math.abs(right.y - centerY)) ||
      comparePositions(left, right),
  );
  const initialPosition = activeCells[0] ?? { x: initialMinX, y: initialMinY };
  const clearanceCells = new Set<string>();
  const initialBuildingConfigs = config.initialBuildings ?? [];
  const initialBuildingIds = new Set<string>();
  const initialFootprintCells = new Set<string>();
  const initialClearanceCells = new Set<string>();
  const initialBuildingById = new Map<string, Building>();
  const capacityForType = (type: BuildingType): number =>
    type === 'home' ? 1 : type === 'workplace' ? 4 : SERVICE_BUILDING_CAPACITY;
  const isFixturePositionValid = (position: GridPosition): boolean =>
    spatial.isPositionActive(position) && !initialFootprintCells.has(coordinateKey(position));
  for (const fixture of initialBuildingConfigs) {
    if (initialBuildingIds.has(fixture.id) || fixture.id.length === 0) {
      throw new Error(`Initial building IDs must be non-empty and unique: ${fixture.id}.`);
    }
    initialBuildingIds.add(fixture.id);
    const footprint = buildingFootprint(fixture.origin, fixture.type);
    const cells = footprintCells(footprint);
    const clearance = buildingClearanceZoneCells(footprint);
    const accessCells = completedBuildingAccessCells(footprint);
    if (
      cells.some((cell) => !spatial.isPositionActive(cell)) ||
      cells.some((cell) => initialFootprintCells.has(coordinateKey(cell))) ||
      cells.some((cell) => initialClearanceCells.has(coordinateKey(cell))) ||
      clearance.some((cell) => initialFootprintCells.has(coordinateKey(cell))) ||
      clearance.some((cell) => initialClearanceCells.has(coordinateKey(cell))) ||
      clearance.some((cell) => !spatial.isBuildable(cell)) ||
      accessCells.some((cell) => !spatial.isBuildable(cell))
    ) {
      throw new Error(`Initial building ${fixture.id} overlaps or violates active clearance.`);
    }
    const entrance = fixture.entrance ?? completedBuildingAccessCells(footprint)[0];
    if (
      entrance === undefined ||
      !isExteriorEntrance(entrance, footprint) ||
      !spatial.isPositionActive(entrance) ||
      !isFixturePositionValid(entrance)
    ) {
      throw new Error(`Initial building ${fixture.id} requires an active exterior entrance.`);
    }
    const building: Building = {
      id: fixture.id,
      type: fixture.type,
      footprint,
      entrance: copyPosition(entrance),
      accessCells: accessCells.map(copyPosition),
      capacity: capacityForType(fixture.type),
    };
    buildings.push(building);
    buildingsById.set(building.id, building);
    initialBuildingById.set(building.id, building);
    for (const cell of cells) initialFootprintCells.add(coordinateKey(cell));
    for (const cell of clearance) initialClearanceCells.add(coordinateKey(cell));
    for (const cell of clearance) clearanceCells.add(coordinateKey(cell));
  }
  spatial.blockMany(
    [...initialFootprintCells].map((key) => {
      const separator = key.indexOf(',');
      return {
        x: Number(key.slice(0, separator)),
        y: Number(key.slice(separator + 1)),
      };
    }),
  );
  // Build one deterministic connected-component map for fixture portal validation.
  // This avoids running a full path search once per initial citizen.
  const componentByPosition = new Map<string, number>();
  let nextComponentId = 0;
  const componentFor = (start: GridPosition): number => {
    const startKey = coordinateKey(start);
    const existing = componentByPosition.get(startKey);
    if (existing !== undefined) return existing;
    if (!spatial.isPositionActive(start) || !spatial.isWalkable(start)) return -1;
    const component = nextComponentId;
    nextComponentId += 1;
    const queue: GridPosition[] = [copyPosition(start)];
    componentByPosition.set(startKey, component);
    for (const current of queue) {
      for (const direction of [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ]) {
        const next = { x: current.x + direction.x, y: current.y + direction.y };
        const key = coordinateKey(next);
        if (
          componentByPosition.has(key) ||
          !spatial.isPositionActive(next) ||
          !spatial.isWalkable(next)
        )
          continue;
        componentByPosition.set(key, component);
        queue.push(next);
      }
    }
    return component;
  };
  const initialCitizenConfigs: readonly InitialCitizenConfig[] =
    config.initialCitizens ??
    (config.initialBuildings !== undefined
      ? []
      : Array.from({ length: initialPopulation }, (_, index) => ({
          id: `citizen-${String(index + 1)}`,
        })));
  const initialCitizenIds = new Set<string>();
  const initialHomeOccupancy = new Map<string, number>();
  const initialWorkOccupancy = new Map<string, number>();
  for (const fixture of initialCitizenConfigs) {
    if (initialCitizenIds.has(fixture.id) || fixture.id.length === 0) {
      throw new Error(`Initial citizen IDs must be non-empty and unique: ${fixture.id}.`);
    }
    initialCitizenIds.add(fixture.id);
    const homeId = fixture.homeBuildingId ?? null;
    const workId = fixture.workplaceBuildingId ?? null;
    const home = homeId === null ? null : initialBuildingById.get(homeId);
    const workplace = workId === null ? null : initialBuildingById.get(workId);
    if ((homeId !== null && home === undefined) || (workId !== null && workplace === undefined)) {
      throw new Error(`Initial citizen ${fixture.id} references an unknown building.`);
    }
    if ((home === null) !== (workplace === null)) {
      throw new Error(
        `Initial citizen ${fixture.id} must have both home and workplace or neither.`,
      );
    }
    if (home !== null && home?.type !== 'home')
      throw new Error(`Initial citizen ${fixture.id} home must be a home.`);
    if (workplace !== null && workplace?.type !== 'workplace')
      throw new Error(`Initial citizen ${fixture.id} workplace must be a workplace.`);
    if (home !== null)
      initialHomeOccupancy.set(home.id, (initialHomeOccupancy.get(home.id) ?? 0) + 1);
    if (workplace !== null)
      initialWorkOccupancy.set(workplace.id, (initialWorkOccupancy.get(workplace.id) ?? 0) + 1);
    const position = fixture.position ?? home?.entrance ?? initialPosition;
    if (!spatial.isPositionActive(position) || initialFootprintCells.has(coordinateKey(position))) {
      throw new Error(`Initial citizen ${fixture.id} must start on active walkable land.`);
    }
    if (home !== null && workplace !== null) {
      const homeComponents = new Set(
        (home.accessCells ?? [home.entrance])
          .map(componentFor)
          .filter((component) => component >= 0),
      );
      const reachable = (workplace.accessCells ?? [workplace.entrance]).some((cell) =>
        homeComponents.has(componentFor(cell)),
      );
      if (!reachable) {
        throw new Error(`Initial citizen ${fixture.id} home/work route is unreachable.`);
      }
    }
  }
  for (const [buildingId, occupied] of initialHomeOccupancy) {
    if (occupied > (initialBuildingById.get(buildingId)?.capacity ?? 0))
      throw new Error(`Initial home capacity exceeded for ${buildingId}.`);
  }
  for (const [buildingId, occupied] of initialWorkOccupancy) {
    if (occupied > (initialBuildingById.get(buildingId)?.capacity ?? 0))
      throw new Error(`Initial workplace capacity exceeded for ${buildingId}.`);
  }
  const createCitizenState = (
    id: string,
    home: Building | null,
    workplace: Building | null,
  ): CitizenState => ({
    id,
    position: copyPosition(home?.entrance ?? initialPosition),
    previousPosition: copyPosition(home?.entrance ?? initialPosition),
    homeBuildingId: home?.id ?? null,
    workplaceBuildingId: workplace?.id ?? null,
    activity: home?.id && workplace?.id ? 'home' : 'idle',
    activityTicksRemaining:
      home?.id && workplace?.id ? 1 + random.nextInteger(activityDurationTicks) : 0,
    departurePending: false,
    route: [],
    routeIndex: 0,
    tripStartedTick: null,
    waitTicks: 0,
    serviceNeed: 0,
    serviceDestinationBuildingId: null,
    serviceDestinationReason: null,
    serviceWaitTicks: 0,
    constructionProjectId: null,
    constructionStagingCell: null,
    constructionCadenceTicks: 0,
    resumeDestinationBuildingId: null,
    resumeActivity: null,
    criticalBuilderProjectId: null,
    criticalBuilderReason: null,
  });
  const citizens: CitizenState[] = initialCitizenConfigs.map((fixture) => {
    const home =
      fixture.homeBuildingId === undefined || fixture.homeBuildingId === null
        ? null
        : (initialBuildingById.get(fixture.homeBuildingId) ?? null);
    const workplace =
      fixture.workplaceBuildingId === undefined || fixture.workplaceBuildingId === null
        ? null
        : (initialBuildingById.get(fixture.workplaceBuildingId) ?? null);
    const citizen = createCitizenState(fixture.id, home, workplace);
    if (fixture.position !== undefined) {
      citizen.position = copyPosition(fixture.position);
      citizen.previousPosition = copyPosition(fixture.position);
    }
    if (fixture.activity !== undefined) citizen.activity = fixture.activity;
    return citizen;
  });
  const citizensById = new Map(citizens.map((citizen) => [citizen.id, citizen]));
  let nextCitizenSequence = 1;
  for (const citizen of citizens) {
    const suffix = Number(citizen.id.replace(/^citizen-/, ''));
    if (Number.isSafeInteger(suffix) && suffix >= nextCitizenSequence)
      nextCitizenSequence = suffix + 1;
  }

  let tick = 0;
  let completedTrips = 0;
  let completedActivities = 0;
  let completedWorkActivities = 0;
  let completedServiceActivities = 0;
  let serviceTrips = 0;
  let serviceUses = 0;
  let failedServiceDestinationAttempts = 0;
  let serviceWaitTicks = 0;
  let totalTripDurationTicks = 0;
  let data = startingData;
  let dataGeneratedThisTick = 0;
  let dataGeneratedThisTickBySource = { work: 0, service: 0 };
  let dataBySource = { work: 0, service: 0 };
  const seeds: DistrictSeed[] = [];
  const constructionProjects: ConstructionProjectState[] = [];
  let servicesCorePurchased = false;
  let selectedResearchFocus: ResearchFocus | null = null;
  for (const building of buildings) {
    for (const cell of buildingClearanceZoneCells(building.footprint)) {
      clearanceCells.add(coordinateKey(cell));
    }
  }
  const isActiveLandWalkable = (position: GridPosition): boolean => spatial.isWalkable(position);
  let nextConstructionProjectId = 1;
  const nextBuildingSequence: Record<BuildingType, number> = {
    home: 1,
    workplace: 1,
    service: 1,
  };
  for (const building of buildings) {
    const prefix = `${building.type}-`;
    if (!building.id.startsWith(prefix)) continue;
    const suffix = Number(building.id.slice(prefix.length));
    if (Number.isSafeInteger(suffix) && suffix >= nextBuildingSequence[building.type]) {
      nextBuildingSequence[building.type] = suffix + 1;
    }
  }
  let lastDevelopmentCandidates: DevelopmentCandidate[] = [];
  let developmentEvaluations = 0;
  let developmentCandidatesScored = 0;
  let developmentFootprintsRejected = 0;
  let developmentEntrancesRejected = 0;
  let constructionProjectsStarted = 0;
  let constructionProjectsCompleted = 0;
  let developmentStateVersion = 0;
  let developmentJob: DevelopmentJobState | undefined;
  let lastDevelopmentProgress: DevelopmentJobProgress = {
    stage: 'idle',
    stateVersion: developmentStateVersion,
    relevantChunkCount: 0,
    chunkIndex: 0,
    buildingTypeIndex: 0,
    anchorChecksThisTick: 0,
    preliminaryCandidatesRetained: 0,
    finalistsValidatedThisTick: 0,
    totalAnchorChecks: 0,
    totalFinalistsValidated: 0,
  };
  let developmentJobsStarted = 0;
  let developmentJobsSuperseded = 0;
  let developmentJobsCompleted = 0;
  let developmentAnchorChecks = 0;
  let developmentPreliminaryCandidatesRetained = 0;
  let developmentFinalistValidations = 0;
  let developmentUnreachableRejections = 0;
  let developmentAffectedRouteReplans = 0;
  const developmentRoutePreservationChecks = 0;
  let developmentPeakAnchorChecksPerTick = 0;
  let developmentPeakFinalistValidationsPerTick = 0;
  let nextSeedId = 1;
  let demandChunksDirtied = 0;
  let demandChunksEvaluated = 0;
  let pathNodesExpanded = 0;
  let pathChunksTouched = 0;
  let movementProposals = 0;
  let movementCommittedMoves = 0;
  let movementBlockedMoves = 0;
  let movementTargetConflicts = 0;
  let movementDependencyBlocks = 0;
  let movementCyclesCommitted = 0;
  let movementOrdinarySwapsRejected = 0;
  let movementReplansAttempted = 0;
  let movementReplansSucceeded = 0;
  let movementReplansUnchanged = 0;
  let movementDeadlockRecoveries = 0;
  let movementCriticalPriorityWins = 0;
  let constructionAssignmentsOffered = 0;
  let constructionAssignmentsAccepted = 0;
  let constructionCommutes = 0;
  let constructionWorkerArrivals = 0;
  let constructionLaborUnits = 0;
  let constructionPausedProjectTicks = 0;
  let constructionPhaseCompletions = 0;
  let constructionWorkerReleases = 0;
  let constructionCriticalPromotions = 0;
  let constructionCriticalClears = 0;
  let constructionCriticalNoEligibleWorkerTicks = 0;
  let constructionCriticalConflictWins = 0;
  const deadlockPairStates = new Map<string, DeadlockPairState>();
  const demandChunks = new Map<string, DemandChunkState>();
  const demandCitizens = (): readonly {
    readonly homeBuildingId: string | null;
    readonly workplaceBuildingId: string | null;
    readonly serviceNeed: number;
    readonly serviceBuildingId: string | null;
  }[] =>
    citizens.map(
      ({ homeBuildingId, workplaceBuildingId, serviceNeed, serviceDestinationBuildingId }) => ({
        homeBuildingId,
        workplaceBuildingId,
        serviceNeed,
        serviceBuildingId: serviceDestinationBuildingId,
      }),
    );

  const isDistrictSeedKind = (value: unknown): value is DistrictSeedKind =>
    value === 'living' || value === 'working' || value === 'services';

  const activeSameTypeSeedCount = (kind: DistrictSeedKind): number =>
    seeds.reduce((count, seed) => count + (seed.kind === kind ? 1 : 0), 0);

  const currentDistrictSeedCost = (kind: DistrictSeedKind): number =>
    getDistrictSeedCost(kind, activeSameTypeSeedCount(kind));

  const isResearchFocus = (value: unknown): value is ResearchFocus =>
    value === 'space' || value === 'access' || value === 'activity';

  const servicesCoreRequirements = (): ServicesCoreState['requirements'] => [
    {
      key: 'living-seed',
      label: 'One Living seed',
      current: activeSameTypeSeedCount('living'),
      required: 1,
      met: activeSameTypeSeedCount('living') >= 1,
    },
    {
      key: 'working-seed',
      label: 'One Working seed',
      current: activeSameTypeSeedCount('working'),
      required: 1,
      met: activeSameTypeSeedCount('working') >= 1,
    },
    {
      key: 'population',
      label: 'Population',
      current: citizens.length,
      required: SERVICES_CORE_MINIMUM_POPULATION,
      met: citizens.length >= SERVICES_CORE_MINIMUM_POPULATION,
    },
    {
      key: 'completed-work-activities',
      label: 'Completed work activities',
      current: completedWorkActivities,
      required: SERVICES_CORE_MINIMUM_WORK_ACTIVITIES,
      met: completedWorkActivities >= SERVICES_CORE_MINIMUM_WORK_ACTIVITIES,
    },
  ];

  const servicesCoreState = (): ServicesCoreState => {
    const requirements = servicesCoreRequirements();
    const missingRequirements = requirements
      .filter((requirement) => !requirement.met)
      .map((requirement) => requirement.key);
    return {
      core: 'services',
      cost: SERVICES_CORE_COST,
      purchased: servicesCorePurchased,
      unlocked: servicesCorePurchased,
      focus: selectedResearchFocus,
      selectedFocus: selectedResearchFocus,
      requirements: requirements.map((requirement) => ({ ...requirement })),
      missingRequirements: [...missingRequirements],
    };
  };

  const coreState = (): CoreState => ({ servicesCore: servicesCoreState() });

  const corePurchaseInfo = (core: CoreProtocol = 'services'): CorePurchaseInfo => {
    const state = servicesCoreState();
    return {
      core,
      cost: SERVICES_CORE_COST,
      eligible:
        !state.purchased && state.missingRequirements.length === 0 && data >= SERVICES_CORE_COST,
      focusRequired: !state.purchased,
      missingRequirements: [...state.missingRequirements],
    };
  };

  const purchaseCore = (command: PurchaseCoreCommand): CorePurchaseResult => {
    const requestedCore: unknown = (command as { readonly core?: unknown }).core;
    if (requestedCore !== undefined && requestedCore !== 'services') {
      return { accepted: false, reason: 'invalid-focus' };
    }
    if (!isResearchFocus(command.focus)) {
      return { accepted: false, reason: 'invalid-focus' };
    }
    if (servicesCorePurchased) return { accepted: false, reason: 'already-purchased' };
    const info = corePurchaseInfo('services');
    if (info.missingRequirements.length > 0) {
      return { accepted: false, reason: 'missing-prerequisites' };
    }
    if (data < SERVICES_CORE_COST) return { accepted: false, reason: 'insufficient-data' };
    data = roundData(data - SERVICES_CORE_COST);
    servicesCorePurchased = true;
    selectedResearchFocus = command.focus;
    developmentStateVersion += 1;
    markAllDemandChunksDirty();
    refreshDirtyDemandChunks();
    return {
      accepted: true,
      core: 'services',
      focus: command.focus,
      cost: SERVICES_CORE_COST,
    };
  };

  const validateDistrictSeedPlacement = (
    command: PlaceDistrictSeedCommand,
  ): DistrictSeedPlacementValidation => {
    const requestedKind: unknown = command.kind;
    if (!isDistrictSeedKind(requestedKind)) {
      return { accepted: false, reason: 'invalid-kind' };
    }
    if (
      !isDistrictSeedKindUnlocked(requestedKind) &&
      !(requestedKind === 'services' && servicesCorePurchased)
    ) {
      return { accepted: false, reason: 'locked' };
    }
    const requestedPosition = command.position;
    if (!Number.isSafeInteger(requestedPosition.x) || !Number.isSafeInteger(requestedPosition.y)) {
      return { accepted: false, reason: 'out-of-bounds' };
    }
    if (!spatial.isPositionActive(requestedPosition)) {
      return { accepted: false, reason: 'inactive-chunk' };
    }
    if (!spatial.isBuildable(requestedPosition)) {
      return {
        accepted: false,
        reason: 'occupied',
      };
    }
    if (seeds.some((districtSeed) => positionsEqual(districtSeed.position, requestedPosition))) {
      return { accepted: false, reason: 'occupied' };
    }
    const cost = currentDistrictSeedCost(requestedKind);
    if (data < cost) return { accepted: false, reason: 'insufficient-data' };
    return {
      accepted: true,
      kind: requestedKind,
      position: copyPosition(requestedPosition),
      cost,
    };
  };

  const districtSeedPlacementInfo = (
    command: PlaceDistrictSeedCommand,
  ): DistrictSeedPlacementInfo => {
    const requestedPosition = copyPosition(command.position);
    const requestedKind: unknown = command.kind;
    const kind: DistrictSeedKind = isDistrictSeedKind(requestedKind) ? requestedKind : 'living';
    const definition = getDistrictSeedDefinition(kind);
    const coveredCells = enumerateDistrictSeedInfluenceCells(requestedPosition, kind);
    const activeCoveredCells = coveredCells.filter((cell) => spatial.isPositionActive(cell));
    const validation = validateDistrictSeedPlacement(command);
    return {
      kind,
      position: requestedPosition,
      radius: definition.influenceRadius,
      sideLength: definition.sideLength,
      cost: isDistrictSeedKind(requestedKind) ? currentDistrictSeedCost(requestedKind) : 0,
      coveredCellCount: coveredCells.length,
      activeCoveredCellCount: activeCoveredCells.length,
      inactiveCoveredCellCount: coveredCells.length - activeCoveredCells.length,
      coveredCells: coveredCells.map(copyPosition),
      activeCoveredCells: activeCoveredCells.map(copyPosition),
      valid: validation.accepted,
      ...(validation.accepted ? {} : { reason: validation.reason }),
    };
  };

  const simulationDistrictSeedDefinition = (kind: DistrictSeedKind): DistrictSeedDefinition => {
    const definition = getDistrictSeedDefinition(kind);
    return {
      ...definition,
      unlocked: kind === 'services' ? servicesCorePurchased : definition.unlocked,
    };
  };

  const simulationDistrictSeedDefinitions = (): readonly DistrictSeedDefinition[] =>
    (['living', 'working', 'services'] as const).map((kind) =>
      simulationDistrictSeedDefinition(kind),
    );

  const buildingById = (id: string): Building => {
    const building = buildingsById.get(id);
    if (building === undefined) throw new Error(`Citizen references missing building ${id}.`);
    return building;
  };

  const activeExtent = (): {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  } => {
    const active = spatial.getActiveChunks();
    const first = active[0];
    const last = active.at(-1);
    if (first === undefined || last === undefined)
      throw new Error('At least one chunk is required.');
    const minX = Math.min(...active.map((chunk) => chunk.x)) * chunkSize;
    const minY = Math.min(...active.map((chunk) => chunk.y)) * chunkSize;
    const maxX = (Math.max(...active.map((chunk) => chunk.x)) + 1) * chunkSize - 1;
    const maxY = (Math.max(...active.map((chunk) => chunk.y)) + 1) * chunkSize - 1;
    return { minX, minY, maxX, maxY };
  };

  const calculateMetrics = (): {
    readonly metrics: CityMetrics;
    readonly averageTripDurationTicks: number;
  } => {
    const population = citizens.length;
    const housingTotal = buildings
      .filter((building) => building.type === 'home')
      .reduce((total, building) => total + building.capacity, 0);
    const workplaceTotal = buildings
      .filter((building) => building.type === 'workplace')
      .reduce((total, building) => total + building.capacity, 0);
    const space =
      population === 0
        ? 1
        : clampUnit(Math.min(housingTotal / population, workplaceTotal / population));
    const plannedTripDistances = citizens
      .filter((citizen) => citizen.homeBuildingId !== null && citizen.workplaceBuildingId !== null)
      .map((citizen) => {
        const homeId = citizen.homeBuildingId;
        const workplaceId = citizen.workplaceBuildingId;
        if (homeId === null || workplaceId === null) {
          throw new Error(`Citizen ${citizen.id} lacks a planned trip assignment.`);
        }
        return orthogonalTravelDistance(
          buildingById(homeId).entrance,
          buildingById(workplaceId).entrance,
        );
      });
    const plannedAverageTripDuration =
      plannedTripDistances.length === 0
        ? 0
        : plannedTripDistances.reduce((total, distance) => total + distance, 0) /
          plannedTripDistances.length;
    const averageTripDurationTicks =
      completedTrips === 0 ? plannedAverageTripDuration : totalTripDurationTicks / completedTrips;
    const extent = activeExtent();
    const longestGridTrip = Math.max(1, extent.maxX - extent.minX + extent.maxY - extent.minY);
    const access = clampUnit(1 - averageTripDurationTicks / longestGridTrip);
    const productiveCitizens = citizens.filter((citizen) => citizen.activity === 'work').length;
    const activity = population === 0 ? 1 : productiveCitizens / population;
    return { metrics: { space, access, activity }, averageTripDurationTicks };
  };

  const createDemandState = (chunk: ChunkCoordinate, dirty: boolean): DemandChunkState => ({
    coordinate: copyChunk(chunk),
    key: chunkKey(chunk),
    values: undefined,
    totals: zeroTotals(),
    revision: 0,
    dirty,
  });

  const markDemandChunkDirty = (chunk: ChunkCoordinate): void => {
    if (!spatial.isActive(chunk)) return;
    const key = chunkKey(chunk);
    let state = demandChunks.get(key);
    if (state === undefined) {
      state = createDemandState(chunk, true);
      demandChunks.set(key, state);
      demandChunksDirtied += 1;
      return;
    }
    if (state.dirty) return;
    state.dirty = true;
    demandChunksDirtied += 1;
  };

  const markAllDemandChunksDirty = (): void => {
    for (const chunk of spatial.getActiveChunks()) markDemandChunkDirty(chunk);
  };

  const markDemandAroundPosition = (position: GridPosition): void => {
    const radius = Math.max(
      districtSeedInfluenceRadius('living'),
      districtSeedInfluenceRadius('working'),
      districtSeedInfluenceRadius('services'),
      demandInfluenceRadius,
    );
    const minChunk = chunkCoordinateForPosition(
      { x: position.x - radius, y: position.y - radius },
      chunkSize,
    );
    const maxChunk = chunkCoordinateForPosition(
      { x: position.x + radius, y: position.y + radius },
      chunkSize,
    );
    for (let y = minChunk.y; y <= maxChunk.y; y += 1) {
      for (let x = minChunk.x; x <= maxChunk.x; x += 1) {
        markDemandChunkDirty({ x, y });
      }
    }
  };

  const markDemandForActivation = (chunk: ChunkCoordinate): void => {
    markDemandChunkDirty(chunk);
    for (const direction of [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ] as const) {
      markDemandChunkDirty({ x: chunk.x + direction.x, y: chunk.y + direction.y });
    }
  };

  const evaluateDemandChunk = (chunk: ChunkCoordinate): DemandChunkState => {
    const key = chunkKey(chunk);
    let state = demandChunks.get(key);
    if (state === undefined) {
      state = createDemandState(chunk, true);
      demandChunks.set(key, state);
      demandChunksDirtied += 1;
    }
    if (!state.dirty && state.values !== undefined) return state;
    const { metrics } = calculateMetrics();
    const evaluated = calculateDemandChunk({
      chunk,
      chunkSize,
      buildings,
      citizens: demandCitizens(),
      metrics,
      seedInfluenceRadius: Math.max(
        demandInfluenceRadius,
        districtSeedInfluenceRadius('living'),
        districtSeedInfluenceRadius('working'),
        districtSeedInfluenceRadius('services'),
      ),
      servicesEnabled: servicesCorePurchased,
      seedInfluence: (position, kind) =>
        calculateDistrictSeedInfluence({
          seeds,
          position,
          kind,
        }),
      revision: state.revision + 1,
    });
    const values = new Float64Array(chunkSize * chunkSize * 3);
    for (const [index, cell] of evaluated.cells.entries()) {
      values[buildingCellIndex(index, 'living')] = cell.living;
      values[buildingCellIndex(index, 'working')] = cell.working;
      values[buildingCellIndex(index, 'services')] = cell.services;
    }
    state.values = values;
    state.totals = copyTotals(evaluated.totals);
    state.revision = evaluated.revision;
    state.dirty = false;
    demandChunksEvaluated += 1;
    return state;
  };

  const refreshDirtyDemandChunks = (): void => {
    for (const chunk of spatial.getActiveChunks().sort(compareChunks)) {
      const state = demandChunks.get(chunkKey(chunk));
      if (state?.dirty === true) evaluateDemandChunk(chunk);
    }
  };

  const cellFromState = (state: DemandChunkState, localIndex: number): DemandCell => {
    if (state.values === undefined) throw new Error(`Demand chunk ${state.key} is not evaluated.`);
    const originX = state.coordinate.x * chunkSize;
    const originY = state.coordinate.y * chunkSize;
    const localX = localIndex % chunkSize;
    const localY = Math.floor(localIndex / chunkSize);
    return {
      position: { x: originX + localX, y: originY + localY },
      living: state.values[buildingCellIndex(localIndex, 'living')] ?? 0,
      working: state.values[buildingCellIndex(localIndex, 'working')] ?? 0,
      services: state.values[buildingCellIndex(localIndex, 'services')] ?? 0,
    };
  };

  const copyDemandChunk = (state: DemandChunkState): DemandChunkSnapshot => {
    const cells: DemandCell[] = [];
    for (let index = 0; index < chunkSize * chunkSize; index += 1) {
      cells.push(cellFromState(state, index));
    }
    return {
      chunk: copyChunk(state.coordinate),
      key: state.key,
      revision: state.revision,
      cellCount: cells.length,
      totals: copyTotals(state.totals),
      cells,
    };
  };

  for (const chunk of initialChunks) markDemandChunkDirty(chunk);
  refreshDirtyDemandChunks();

  const sortedCitizens = (): CitizenState[] => [...citizens].sort(compareCitizenIds);

  const clearDeadlockPairsForCitizen = (citizenId: string): void => {
    for (const [key, state] of deadlockPairStates) {
      if (state.leftId === citizenId || state.rightId === citizenId) {
        deadlockPairStates.delete(key);
      }
    }
  };

  const clearAllDeadlockPairs = (): void => {
    deadlockPairStates.clear();
  };

  const snapshotMovingOccupancy = (): Map<string, string> => {
    const occupancy = new Map<string, string>();
    for (const citizen of sortedCitizens()) {
      const isExclusiveActivity =
        citizen.activity === 'commuting-to-work' ||
        citizen.activity === 'commuting-home' ||
        citizen.activity === 'commuting-to-service' ||
        citizen.activity === 'commuting-to-construction' ||
        citizen.activity === 'constructing';
      if (!isExclusiveActivity) continue;
      const key = coordinateKey(citizen.position);
      if (occupancy.has(key)) {
        throw new Error(`Moving citizens share exclusive cell ${key}.`);
      }
      occupancy.set(key, citizen.id);
    }
    return occupancy;
  };

  const completeTrip = (citizen: CitizenState, destinationId: string): void => {
    const destination = buildingById(destinationId);
    if (
      !(destination.accessCells ?? [destination.entrance]).some((cell) =>
        positionsEqual(citizen.position, cell),
      )
    ) {
      throw new Error(`Citizen ${citizen.id} did not reach the expected entrance.`);
    }
    if (citizen.tripStartedTick === null) {
      throw new Error(`Citizen ${citizen.id} completed a trip without a start tick.`);
    }
    totalTripDurationTicks += tick - citizen.tripStartedTick;
    citizen.activity = citizen.activity === 'commuting-to-work' ? 'work' : 'home';
    citizen.activityTicksRemaining = activityDurationTicks;
    citizen.departurePending = false;
    citizen.tripStartedTick = null;
    citizen.waitTicks = 0;
    citizen.route = [];
    citizen.routeIndex = 0;
    citizen.serviceDestinationBuildingId = null;
    citizen.serviceDestinationReason = null;
    clearDeadlockPairsForCitizen(citizen.id);
    completedTrips += 1;
  };

  const completeServiceTrip = (citizen: CitizenState, destinationId: string): void => {
    const destination = buildingById(destinationId);
    if (destination.type !== 'service') {
      throw new Error(`Citizen ${citizen.id} has a non-service trip destination.`);
    }
    if (
      !(destination.accessCells ?? [destination.entrance]).some((cell) =>
        positionsEqual(citizen.position, cell),
      )
    ) {
      throw new Error(`Citizen ${citizen.id} did not reach service ${destination.id}.`);
    }
    if (citizen.tripStartedTick === null) {
      throw new Error(`Citizen ${citizen.id} completed a service trip without a start tick.`);
    }
    totalTripDurationTicks += tick - citizen.tripStartedTick;
    citizen.activity = 'service';
    citizen.activityTicksRemaining = SERVICE_USE_DURATION_TICKS;
    citizen.departurePending = false;
    citizen.tripStartedTick = null;
    citizen.waitTicks = 0;
    citizen.route = [];
    citizen.routeIndex = 0;
    clearDeadlockPairsForCitizen(citizen.id);
    completedTrips += 1;
    serviceTrips += 1;
  };

  const completeServiceUse = (citizen: CitizenState): void => {
    if (citizen.activity !== 'service' || citizen.serviceDestinationBuildingId === null) {
      throw new Error(`Citizen ${citizen.id} completed an invalid service use.`);
    }
    if (citizen.serviceNeed < SERVICE_NEED_THRESHOLD) {
      throw new Error(`Citizen ${citizen.id} completed service without sufficient need.`);
    }
    citizen.serviceNeed -= SERVICE_NEED_THRESHOLD;
    citizen.activity = 'home';
    citizen.activityTicksRemaining = activityDurationTicks;
    citizen.departurePending = false;
    citizen.serviceDestinationBuildingId = null;
    citizen.serviceDestinationReason = null;
    citizen.route = [];
    citizen.routeIndex = 0;
    completedServiceActivities += 1;
    completedActivities += 1;
    serviceUses += 1;
  };

  const completeConstructionCommute = (citizen: CitizenState): void => {
    if (citizen.activity !== 'commuting-to-construction') {
      throw new Error(
        `Citizen ${citizen.id} completed a non-construction commute as construction.`,
      );
    }
    if (citizen.constructionProjectId === null || citizen.constructionStagingCell === null) {
      throw new Error(`Construction commuter ${citizen.id} has no staging assignment.`);
    }
    if (!positionsEqual(citizen.position, citizen.constructionStagingCell)) {
      throw new Error(`Construction commuter ${citizen.id} missed its staging cell.`);
    }
    citizen.activity = 'constructing';
    citizen.tripStartedTick = null;
    citizen.waitTicks = 0;
    citizen.departurePending = false;
    clearCriticalForCitizen(citizen);
    constructionWorkerArrivals += 1;
  };

  const startTrip = (
    citizen: CitizenState,
    activity: CitizenActivity,
    destinationId: string,
    movingOccupancy: Map<string, string> = new Map(),
  ): boolean => {
    const destination = buildingById(destinationId);
    clearCriticalForCitizen(citizen);
    const accessGoals = (destination.accessCells ?? [destination.entrance])
      .slice()
      .sort(comparePositions);
    const sourceBuildingId =
      activity === 'commuting-to-work'
        ? citizen.homeBuildingId
        : activity === 'commuting-home'
          ? citizen.workplaceBuildingId
          : activity === 'commuting-to-service'
            ? citizen.homeBuildingId
            : null;
    const sourceBuilding =
      sourceBuildingId === null ? undefined : buildingsById.get(sourceBuildingId);
    const sources = (sourceBuilding?.accessCells ?? [citizen.position])
      .filter((cell) => !movingOccupancy.has(coordinateKey(cell)))
      .filter((cell) => spatial.isPositionActive(cell) && isActiveLandWalkable(cell))
      .sort(comparePositions);
    const result = findGridPathBetweenSets(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        isWalkable: (position) => isActiveLandWalkable(position),
        maxNodes: pathSearchBudget,
      },
      sources,
      accessGoals,
      `${citizen.id}|${sourceBuildingId ?? 'physical'}|${destination.id}`,
    );
    pathNodesExpanded += result.nodesExpanded;
    pathChunksTouched += result.chunksTouched;
    if (result.status !== 'found') {
      return false;
    }
    if (result.source !== null) {
      citizen.position = copyPosition(result.source);
      citizen.previousPosition = copyPosition(result.source);
      movingOccupancy.set(coordinateKey(result.source), citizen.id);
    }
    citizen.activity = activity;
    citizen.departurePending = false;
    citizen.route = result.path.map(copyPosition);
    citizen.routeIndex = 0;
    citizen.tripStartedTick = tick;
    citizen.waitTicks = 0;
    clearDeadlockPairsForCitizen(citizen.id);
    if (citizen.route.length === 1) {
      if (activity === 'commuting-to-service') completeServiceTrip(citizen, destinationId);
      else completeTrip(citizen, destinationId);
      return false;
    }
    return true;
  };

  const demandValueAt = (position: GridPosition, buildingType: BuildingType): number => {
    const chunk = chunkCoordinateForPosition(position, chunkSize);
    const state = demandChunks.get(chunkKey(chunk));
    if (state?.dirty === true || state?.values === undefined) {
      throw new Error(`Demand chunk ${chunkKey(chunk)} was not refreshed before evaluation.`);
    }
    const local = {
      x: position.x - chunk.x * chunkSize,
      y: position.y - chunk.y * chunkSize,
    };
    const cell = cellFromState(state, local.y * chunkSize + local.x);
    switch (buildingType) {
      case 'home':
        return cell.living;
      case 'workplace':
        return cell.working;
      case 'service':
        return cell.services;
    }
  };

  const matchingSeedInfluenceAt = (position: GridPosition, buildingType: BuildingType): number =>
    calculateDistrictSeedInfluence({
      seeds,
      position,
      kind:
        buildingType === 'home' ? 'living' : buildingType === 'workplace' ? 'working' : 'services',
    });

  const occupancyByBuilding = (): Map<string, number> => {
    const occupancy = new Map<string, number>();
    for (const citizen of citizens) {
      if (citizen.homeBuildingId !== null)
        occupancy.set(citizen.homeBuildingId, (occupancy.get(citizen.homeBuildingId) ?? 0) + 1);
      if (citizen.workplaceBuildingId !== null)
        occupancy.set(
          citizen.workplaceBuildingId,
          (occupancy.get(citizen.workplaceBuildingId) ?? 0) + 1,
        );
      if (citizen.serviceDestinationBuildingId !== null) {
        occupancy.set(
          citizen.serviceDestinationBuildingId,
          (occupancy.get(citizen.serviceDestinationBuildingId) ?? 0) + 1,
        );
      }
    }
    return occupancy;
  };

  const occupancySnapshot = (): readonly BuildingOccupancy[] => {
    const occupancy = occupancyByBuilding();
    return buildings.map((building) => {
      const occupied = occupancy.get(building.id) ?? 0;
      return {
        buildingId: building.id,
        buildingType: building.type,
        occupied,
        occupancy: occupied,
        capacity: building.capacity,
        available: building.capacity - occupied,
      };
    });
  };

  const assertPopulationInvariants = (): void => {
    if (citizens.length > populationCap) {
      throw new Error('Population exceeds the configured population cap.');
    }
    if (completedActivities !== completedWorkActivities + completedServiceActivities) {
      throw new Error('Completed activity counters do not reconcile.');
    }
    if (dataBySource.work < 0 || dataBySource.service < 0) {
      throw new Error('Data source counters cannot be negative.');
    }
    if (data < 0) throw new Error('Data cannot be negative.');
    const citizenIds = new Set<string>();
    const occupancy = occupancyByBuilding();
    const blockedCells = new Set<string>();
    for (const building of buildings) {
      for (const cell of footprintCells(building.footprint)) blockedCells.add(coordinateKey(cell));
    }
    for (const project of constructionProjects) {
      for (const cell of footprintCells(project.footprint)) blockedCells.add(coordinateKey(cell));
      if (project.stagingCells.length !== 3) {
        throw new Error(
          `Construction project ${project.id} must have exactly three staging cells.`,
        );
      }
      const stagingKeys = new Set<string>();
      for (const stagingCell of project.stagingCells) {
        const stagingKey = coordinateKey(stagingCell);
        if (stagingKeys.has(stagingKey)) {
          throw new Error(`Construction project ${project.id} repeats a staging cell.`);
        }
        stagingKeys.add(stagingKey);
        if (
          isInsideFootprint(stagingCell, project.footprint) ||
          !spatial.isPositionActive(stagingCell)
        ) {
          throw new Error(`Construction project ${project.id} has invalid staging.`);
        }
      }
      if (
        !Number.isSafeInteger(project.phaseLaborCompleted) ||
        !Number.isSafeInteger(project.phaseLaborRequired) ||
        project.phaseLaborRequired < 1 ||
        project.phaseLaborCompleted < 0 ||
        project.phaseLaborCompleted > project.phaseLaborRequired
      ) {
        throw new Error(`Construction project ${project.id} has invalid labor state.`);
      }
      if (!Number.isSafeInteger(project.ticksSinceLastLabor) || project.ticksSinceLastLabor < 0) {
        throw new Error(`Construction project ${project.id} has invalid labor wait state.`);
      }
      if (project.criticalBuilderId !== null) {
        const criticalCitizen = citizensById.get(project.criticalBuilderId);
        const hasValidCriticalCitizen =
          criticalCitizen?.criticalBuilderProjectId === project.id &&
          criticalCitizen.constructionProjectId === project.id &&
          criticalCitizen.activity === 'commuting-to-construction';
        if (!hasValidCriticalCitizen) {
          throw new Error(`Construction project ${project.id} has an invalid critical builder.`);
        }
      }
    }
    for (const building of buildings) {
      const occupied = occupancy.get(building.id) ?? 0;
      if (!Number.isFinite(building.capacity) || building.capacity < 0) {
        throw new Error(`Building ${building.id} has invalid capacity.`);
      }
      if (occupied < 0 || occupied > building.capacity) {
        throw new Error(`Building ${building.id} exceeds capacity.`);
      }
    }
    const activities: readonly CitizenActivity[] = [
      'idle',
      'home',
      'commuting-to-work',
      'work',
      'commuting-home',
      'commuting-to-service',
      'service',
      'commuting-to-construction',
      'constructing',
    ];
    const movingCells = new Map<string, string>();
    for (const citizen of citizens) {
      if (citizenIds.has(citizen.id)) throw new Error(`Duplicate citizen id ${citizen.id}.`);
      citizenIds.add(citizen.id);
      if (citizen.homeBuildingId !== null) {
        const home = buildingById(citizen.homeBuildingId);
        if (home.type !== 'home') throw new Error(`Citizen ${citizen.id} has an invalid home.`);
      }
      if (citizen.workplaceBuildingId !== null) {
        const workplace = buildingById(citizen.workplaceBuildingId);
        if (workplace.type !== 'workplace')
          throw new Error(`Citizen ${citizen.id} has an invalid workplace.`);
      }
      if (!activities.includes(citizen.activity)) {
        throw new Error(`Citizen ${citizen.id} has an invalid activity.`);
      }
      if (
        !Number.isSafeInteger(citizen.activityTicksRemaining) ||
        citizen.activityTicksRemaining < 0
      ) {
        throw new Error(`Citizen ${citizen.id} has negative schedule state.`);
      }
      if (!Number.isSafeInteger(citizen.waitTicks) || citizen.waitTicks < 0) {
        throw new Error(`Citizen ${citizen.id} has invalid wait state.`);
      }
      if (
        !Number.isSafeInteger(citizen.serviceNeed) ||
        citizen.serviceNeed < 0 ||
        citizen.serviceNeed > SERVICE_NEED_MAX
      ) {
        throw new Error(`Citizen ${citizen.id} has invalid service need.`);
      }
      if (!Number.isSafeInteger(citizen.serviceWaitTicks) || citizen.serviceWaitTicks < 0) {
        throw new Error(`Citizen ${citizen.id} has invalid service wait state.`);
      }
      if (
        (citizen.activity === 'commuting-to-service' || citizen.activity === 'service') &&
        citizen.serviceDestinationBuildingId === null
      ) {
        throw new Error(`Citizen ${citizen.id} has a service activity without a destination.`);
      }
      if (
        citizen.activity !== 'commuting-to-service' &&
        citizen.activity !== 'service' &&
        citizen.serviceDestinationBuildingId !== null
      ) {
        throw new Error(`Citizen ${citizen.id} retains a service destination outside service use.`);
      }
      if (citizen.serviceDestinationBuildingId !== null) {
        const serviceBuilding = buildingById(citizen.serviceDestinationBuildingId);
        if (serviceBuilding.type !== 'service') {
          throw new Error(`Citizen ${citizen.id} has a non-service destination.`);
        }
        if (
          citizen.activity === 'service' &&
          !(serviceBuilding.accessCells ?? [serviceBuilding.entrance]).some((cell) =>
            positionsEqual(citizen.position, cell),
          )
        ) {
          throw new Error(`Citizen ${citizen.id} is using a service away from its entrance.`);
        }
      }
      const constructionProject =
        citizen.constructionProjectId === null
          ? undefined
          : constructionProjects.find((project) => project.id === citizen.constructionProjectId);
      if (citizen.constructionProjectId !== null && constructionProject === undefined) {
        throw new Error(`Citizen ${citizen.id} references missing construction project.`);
      }
      if (citizen.criticalBuilderProjectId !== null) {
        if (
          citizen.constructionProjectId !== citizen.criticalBuilderProjectId ||
          citizen.activity !== 'commuting-to-construction' ||
          constructionProject?.criticalBuilderId !== citizen.id
        ) {
          throw new Error(`Citizen ${citizen.id} has an invalid critical builder state.`);
        }
      } else if (citizen.criticalBuilderReason !== null) {
        throw new Error(`Citizen ${citizen.id} has an orphaned critical builder reason.`);
      }
      if (citizen.constructionProjectId === null) {
        if (citizen.constructionStagingCell !== null) {
          throw new Error(`Citizen ${citizen.id} has a staging cell without a project.`);
        }
        if (citizen.resumeDestinationBuildingId !== null || citizen.resumeActivity !== null) {
          throw new Error(`Citizen ${citizen.id} has an orphaned resume destination.`);
        }
      } else {
        const constructionStagingCell = citizen.constructionStagingCell;
        if (constructionStagingCell === null) {
          throw new Error(`Citizen ${citizen.id} has a project without a staging cell.`);
        }
        if (
          !constructionProject?.stagingCells.some((cell) =>
            positionsEqual(cell, constructionStagingCell),
          )
        ) {
          throw new Error(`Citizen ${citizen.id} has an invalid construction staging cell.`);
        }
        if (
          citizen.activity !== 'commuting-to-construction' &&
          citizen.activity !== 'constructing'
        ) {
          throw new Error(`Citizen ${citizen.id} has an invalid construction activity.`);
        }
        if (
          citizen.activity === 'constructing' &&
          !positionsEqual(citizen.position, constructionStagingCell)
        ) {
          throw new Error(`Constructing citizen ${citizen.id} is away from staging.`);
        }
      }
      if (
        (citizen.activity === 'commuting-to-work' ||
          citizen.activity === 'commuting-home' ||
          citizen.activity === 'commuting-to-service' ||
          citizen.activity === 'commuting-to-construction') &&
        citizen.route.length === 0
      ) {
        throw new Error(`Commuter ${citizen.id} has an empty route.`);
      }
      if (
        citizen.activity === 'commuting-to-work' ||
        citizen.activity === 'commuting-home' ||
        citizen.activity === 'commuting-to-service' ||
        citizen.activity === 'commuting-to-construction' ||
        citizen.activity === 'constructing'
      ) {
        const movingCell = coordinateKey(citizen.position);
        if (movingCells.has(movingCell)) {
          throw new Error(`Moving citizens share exclusive cell ${movingCell}.`);
        }
        movingCells.set(movingCell, citizen.id);
        const routePosition = citizen.route[citizen.routeIndex];
        if (routePosition === undefined || !positionsEqual(routePosition, citizen.position)) {
          throw new Error(`Citizen ${citizen.id} is not at its route index.`);
        }
      }
      if (!spatial.isPositionActive(citizen.position) || !isActiveLandWalkable(citizen.position)) {
        throw new Error(`Citizen ${citizen.id} is outside active walkable space.`);
      }
      if (blockedCells.has(coordinateKey(citizen.position))) {
        throw new Error(`Citizen ${citizen.id} occupies a blocked interior.`);
      }
      if (
        !spatial.isPositionActive(citizen.previousPosition) ||
        !isActiveLandWalkable(citizen.previousPosition) ||
        blockedCells.has(coordinateKey(citizen.previousPosition))
      ) {
        throw new Error(`Citizen ${citizen.id} has an invalid previous position.`);
      }
      if (!Number.isSafeInteger(citizen.routeIndex) || citizen.routeIndex < 0) {
        throw new Error(`Citizen ${citizen.id} has an invalid route index.`);
      }
      if (citizen.route.length === 0 && citizen.routeIndex !== 0) {
        throw new Error(`Citizen ${citizen.id} has an invalid empty route index.`);
      }
      if (citizen.route.length > 0 && citizen.routeIndex >= citizen.route.length) {
        throw new Error(`Citizen ${citizen.id} route index is out of bounds.`);
      }
      for (let index = 0; index < citizen.route.length; index += 1) {
        const position = citizen.route[index];
        if (position === undefined) throw new Error(`Citizen ${citizen.id} route is sparse.`);
        if (!spatial.isPositionActive(position) || !isActiveLandWalkable(position)) {
          throw new Error(`Citizen ${citizen.id} route leaves walkable space.`);
        }
        if (blockedCells.has(coordinateKey(position))) {
          throw new Error(`Citizen ${citizen.id} route enters a blocked interior.`);
        }
        const previous = citizen.route[index - 1];
        if (previous !== undefined && orthogonalTravelDistance(previous, position) !== 1) {
          throw new Error(`Citizen ${citizen.id} route contains a non-adjacent move.`);
        }
      }
    }
    for (const project of constructionProjects) {
      const workers = constructionWorkers(project.id);
      const constructingWorkers = workers.filter((worker) => worker.activity === 'constructing');
      if (workers.length > constructionPhaseMaxWorkers(project.phase)) {
        throw new Error(`Construction project ${project.id} exceeds its worker cap.`);
      }
      if (project.paused !== (constructingWorkers.length === 0)) {
        throw new Error(`Construction project ${project.id} has an invalid paused state.`);
      }
    }
  };

  const localSameUseSaturation = (
    position: GridPosition,
    buildingType: BuildingType,
    occupancy: ReadonlyMap<string, number>,
  ): number => {
    let weightedSaturation = 0;
    let totalWeight = 0;
    for (const building of buildings) {
      if (building.type !== buildingType) continue;
      const weight = normalizedDistance(
        distanceToRect(position, building.footprint),
        demandInfluenceRadius,
      );
      const saturation =
        building.capacity === 0
          ? occupancy.get(building.id) === 0
            ? 0
            : 1
          : clampUnit((occupancy.get(building.id) ?? 0) / building.capacity);
      weightedSaturation += weight * saturation;
      totalWeight += weight;
    }
    return totalWeight === 0 ? 0 : clampUnit(weightedSaturation / totalWeight);
  };

  const complementaryUseFactor = (position: GridPosition, buildingType: BuildingType): number => {
    const opposites: readonly BuildingType[] =
      buildingType === 'home'
        ? ['workplace']
        : buildingType === 'workplace'
          ? ['home']
          : ['home', 'workplace'];
    let factor = 0;
    for (const building of buildings) {
      if (!opposites.includes(building.type)) continue;
      factor = Math.max(
        factor,
        normalizedDistance(distanceToRect(position, building.footprint), demandInfluenceRadius),
      );
    }
    return factor;
  };

  const expectedAccessImprovement = (
    entrance: GridPosition,
    buildingType: BuildingType,
  ): number => {
    const opposites: readonly BuildingType[] =
      buildingType === 'home'
        ? ['workplace']
        : buildingType === 'workplace'
          ? ['home']
          : ['home', 'workplace'];
    let factor = 0;
    for (const building of buildings) {
      if (!opposites.includes(building.type)) continue;
      factor = Math.max(
        factor,
        normalizedDistance(squareDistance(entrance, building.entrance), demandInfluenceRadius),
      );
    }
    return factor;
  };

  const pathExistsWithBlockedCells = (
    start: GridPosition,
    goal: GridPosition,
    blocked: ReadonlySet<string>,
  ): boolean => {
    if (blocked.has(coordinateKey(start)) || blocked.has(coordinateKey(goal))) return false;
    if (!isActiveLandWalkable(start) || !isActiveLandWalkable(goal)) return false;
    const result = findGridPathDetailed(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        isWalkable: (position) =>
          isActiveLandWalkable(position) && !blocked.has(coordinateKey(position)),
        maxNodes: pathSearchBudget,
      },
      start,
      goal,
    );
    pathNodesExpanded += result.nodesExpanded;
    pathChunksTouched += result.chunksTouched;
    return result.status === 'found';
  };

  const pairHasRoute = (home: Building, workplace: Building): boolean =>
    pathExistsWithBlockedCells(home.entrance, workplace.entrance, new Set<string>());

  type CandidateValidation = { readonly status: 'valid' } | { readonly status: 'unreachable' };

  const existingProjectFootprints = (): readonly Building['footprint'][] => [
    ...buildings.map((building) => building.footprint),
    ...constructionProjects.map((project) => project.footprint),
  ];

  const existingClearanceCells = (): ReadonlySet<string> => new Set(clearanceCells);

  const movingExclusiveCells = (): ReadonlySet<string> => {
    const cells = new Set<string>();
    for (const citizen of citizens) {
      if (
        citizen.activity !== 'commuting-to-work' &&
        citizen.activity !== 'commuting-home' &&
        citizen.activity !== 'commuting-to-service' &&
        citizen.activity !== 'commuting-to-construction' &&
        citizen.activity !== 'constructing'
      )
        continue;
      cells.add(coordinateKey(citizen.position));
    }
    return cells;
  };

  const isRectInsideActiveSpace = (rect: Building['footprint']): boolean =>
    footprintCells(rect).every((cell) => spatial.isPositionActive(cell));

  const relevantDevelopmentChunks = (): ChunkCoordinate[] => {
    const metrics = calculateMetrics().metrics;
    const capacityPressure = metrics.space < 1;
    const servicePressure =
      servicesCorePurchased &&
      (citizens.some((citizen) => citizen.serviceNeed >= SERVICE_NEED_THRESHOLD) ||
        !buildings.some((building) => building.type === 'service'));
    const activeChunks = spatial.getActiveChunks().sort(compareChunks);
    if (capacityPressure || servicePressure) return activeChunks;
    return activeChunks.filter((chunk) => {
      const origin = { x: chunk.x * chunkSize, y: chunk.y * chunkSize };
      const farCorner = { x: origin.x + chunkSize - 1, y: origin.y + chunkSize - 1 };
      return seeds.some((seed) => {
        const radius = districtSeedInfluenceRadius(seed.kind);
        const dx =
          seed.position.x < origin.x
            ? origin.x - seed.position.x
            : seed.position.x > farCorner.x
              ? seed.position.x - farCorner.x
              : 0;
        const dy =
          seed.position.y < origin.y
            ? origin.y - seed.position.y
            : seed.position.y > farCorner.y
              ? seed.position.y - farCorner.y
              : 0;
        return Math.max(dx, dy) <= radius;
      });
    });
  };

  const retainPreliminaryCandidate = (
    candidates: DevelopmentCandidate[],
    candidate: DevelopmentCandidate,
  ): void => {
    candidates.push(candidate);
    candidates.sort(compareDevelopmentCandidates);
    if (candidates.length > defaults.developmentPreliminaryCandidateLimit) candidates.pop();
    developmentPreliminaryCandidatesRetained += 1;
  };

  const candidateFromAnchor = (
    anchor: GridPosition,
    buildingType: BuildingType,
    occupancy: ReadonlyMap<string, number>,
  ): DevelopmentCandidate | undefined => {
    if (buildingType === 'service' && !servicesCorePurchased) return undefined;
    const footprint = buildingFootprint(anchor, buildingType);
    const clearanceZone = buildingClearanceZone(footprint);
    const reservedClearance = existingClearanceCells();
    const protectedFootprints = existingProjectFootprints();
    const protectedPositions = movingExclusiveCells();
    const footprintCellsForCandidate = footprintCells(footprint);
    if (
      !isRectInsideActiveSpace(footprint) ||
      footprintCellsForCandidate.some(
        (cell) =>
          !spatial.isBuildable(cell) ||
          reservedClearance.has(coordinateKey(cell)) ||
          protectedPositions.has(coordinateKey(cell)) ||
          protectedFootprints.some((protectedFootprint) =>
            isInsideFootprint(cell, protectedFootprint),
          ),
      )
    ) {
      developmentFootprintsRejected += 1;
      return undefined;
    }
    const clearanceCellsForCandidate = buildingClearanceZoneCells(footprint);
    if (
      clearanceCellsForCandidate.some(
        (cell) =>
          !spatial.isPositionActive(cell) ||
          !spatial.isBuildable(cell) ||
          protectedFootprints.some((protectedFootprint) =>
            isInsideFootprint(cell, protectedFootprint),
          ) ||
          reservedClearance.has(coordinateKey(cell)) ||
          protectedPositions.has(coordinateKey(cell)),
      )
    ) {
      developmentFootprintsRejected += 1;
      return undefined;
    }
    const stagingCandidates = stagingCapableClearanceZoneCells(footprint, {
      isActive: (position) => spatial.isPositionActive(position),
      isWalkable: (position) => spatial.isWalkable(position),
    });
    if (stagingCandidates.length < 3) {
      developmentEntrancesRejected += 1;
      return undefined;
    }
    const entrance = stagingCandidates.find((cell) => isExteriorEntrance(cell, footprint));
    if (entrance === undefined) return undefined;
    const staging = selectProjectStagingCells(footprint, {
      entrance,
      isActive: (position) => spatial.isPositionActive(position),
      isWalkable: (position) => spatial.isWalkable(position),
      count: 3,
    });
    if (staging.length !== 3) {
      developmentEntrancesRejected += 1;
      return undefined;
    }
    const localMatchingDemand = demandValueAt(anchor, buildingType);
    const seedInfluence = matchingSeedInfluenceAt(anchor, buildingType);
    const complementaryUse = complementaryUseFactor(anchor, buildingType);
    const sameUseSaturation = localSameUseSaturation(anchor, buildingType, occupancy);
    const constructionCost = (footprint.width * footprint.height) / 25;
    let nearestBuildingDistance = Number.POSITIVE_INFINITY;
    for (const cell of footprintCellsForCandidate) {
      for (const building of buildings) {
        nearestBuildingDistance = Math.min(
          nearestBuildingDistance,
          squareDistance(cell, building.entrance),
        );
      }
    }
    const entranceAccessibility =
      nearestBuildingDistance === Number.POSITIVE_INFINITY
        ? 0
        : normalizedDistance(nearestBuildingDistance, Math.max(1, demandInfluenceRadius * 2));
    const accessImprovement = expectedAccessImprovement(entrance, buildingType);
    const score = scoreDevelopmentCandidate({
      buildingType,
      localMatchingDemand,
      seedInfluence,
      complementaryUse,
      entranceAccessibility,
      expectedAccessImprovement: accessImprovement,
      sameUseSaturation,
      constructionCost,
    });
    developmentCandidatesScored += 1;
    if (score.score < developmentMinimumScore) return undefined;
    return {
      buildingType,
      anchor: copyPosition(anchor),
      footprint: { ...footprint },
      entrance: copyPosition(entrance),
      entranceOrder: 0,
      score: score.score,
      primaryReason: { ...score.primaryReason },
      localMatchingDemand: roundData(localMatchingDemand),
      seedInfluence: roundData(seedInfluence),
      complementaryUse: roundData(complementaryUse),
      entranceAccessibility: roundData(entranceAccessibility),
      expectedAccessImprovement: roundData(accessImprovement),
      sameUseSaturation: roundData(sameUseSaturation),
      constructionCost: roundData(constructionCost),
      spatialFactor: score.spatialFactor,
      clearanceZone: { ...clearanceZone },
      stagingCells: staging.map(copyPosition),
    };
  };

  const validateCandidateReachability = (candidate: DevelopmentCandidate): CandidateValidation => {
    const goals = candidate.stagingCells ?? [];
    const eligibleCitizens = citizens
      .filter((citizen) => {
        if (citizen.activity === 'idle') return true;
        if (citizen.activity === 'home' && citizen.homeBuildingId !== null) return true;
        if (citizen.activity === 'work' && citizen.workplaceBuildingId !== null) return true;
        return false;
      })
      .sort(compareCitizenIds);
    for (const citizen of eligibleCitizens) {
      const sourceBuildingId =
        citizen.activity === 'home'
          ? citizen.homeBuildingId
          : citizen.activity === 'work'
            ? citizen.workplaceBuildingId
            : null;
      const sourceBuilding =
        sourceBuildingId === null ? undefined : buildingsById.get(sourceBuildingId);
      const sources = sourceBuilding?.accessCells ?? [citizen.position];
      const result = findGridPathBetweenSets(
        {
          chunkSize,
          activeChunks: spatial.getActiveChunks(),
          isWalkable: (position) => isActiveLandWalkable(position),
          maxNodes: pathSearchBudget,
        },
        sources,
        goals,
        `${candidate.buildingType}|${String(candidate.anchor.x)},${String(candidate.anchor.y)}|${citizen.id}`,
      );
      pathNodesExpanded += result.nodesExpanded;
      pathChunksTouched += result.chunksTouched;
      if (result.status === 'found') return { status: 'valid' };
    }
    return { status: 'unreachable' };
  };

  const replanAffectedRoutes = (footprint: Building['footprint']): void => {
    const blocked = new Set(footprintCells(footprint).map(coordinateKey));
    const affected = citizens
      .filter((citizen) =>
        citizen.route.some(
          (position, index) => index > citizen.routeIndex && blocked.has(coordinateKey(position)),
        ),
      )
      .sort(compareCitizenIds);
    if (affected.length === 0) return;
    const movingOccupancy = snapshotMovingOccupancy();
    for (const citizen of affected) {
      if (!replanCitizen(citizen, movingOccupancy, new Map(), false)) {
        throw new Error(
          `Affected route for ${citizen.id} could not replan after project placement.`,
        );
      }
      developmentAffectedRouteReplans += 1;
    }
  };

  const capacityForDevelopment = (buildingType: BuildingType): number =>
    buildingType === 'home'
      ? developmentHomeCapacity
      : buildingType === 'workplace'
        ? developmentWorkplaceCapacity
        : SERVICE_BUILDING_CAPACITY;

  const reservedConstructionStagingCells = (): ReadonlySet<string> => {
    const reserved = new Set<string>();
    for (const citizen of citizens) {
      if (citizen.constructionProjectId === null || citizen.constructionStagingCell === null) {
        continue;
      }
      reserved.add(coordinateKey(citizen.constructionStagingCell));
    }
    return reserved;
  };

  const selectConstructionStaging = (
    candidate: DevelopmentCandidate,
  ): GridPosition[] | undefined => {
    if (candidate.stagingCells?.length !== 3) {
      return undefined;
    }
    const reserved = reservedConstructionStagingCells();
    const capableCells = new Set(
      stagingCapableClearanceZoneCells(candidate.footprint, {
        isActive: (position) => spatial.isPositionActive(position),
        isWalkable: (position) => spatial.isWalkable(position),
      }).map(coordinateKey),
    );
    const keys = new Set<string>();
    for (const [index, stagingCell] of candidate.stagingCells.entries()) {
      const key = coordinateKey(stagingCell);
      if (
        keys.has(key) ||
        reserved.has(key) ||
        !capableCells.has(key) ||
        (index === 0 && !positionsEqual(stagingCell, candidate.entrance))
      ) {
        return undefined;
      }
      keys.add(key);
    }
    return candidate.stagingCells.map(copyPosition);
  };

  const compactConsumedRoutePrefixes = (): void => {
    for (const citizen of sortedCitizens()) {
      if (citizen.routeIndex === 0) continue;
      const current = citizen.route[citizen.routeIndex];
      if (current === undefined || !positionsEqual(current, citizen.position)) {
        throw new Error(`Citizen ${citizen.id} is not at its route index before construction.`);
      }
      citizen.route = citizen.route.slice(citizen.routeIndex).map(copyPosition);
      citizen.routeIndex = 0;
    }
  };

  const startConstruction = (candidate: DevelopmentCandidate): boolean => {
    const stagingCells = selectConstructionStaging(candidate);
    if (stagingCells === undefined) {
      developmentEntrancesRejected += 1;
      return false;
    }
    const footprint = footprintCells(candidate.footprint);
    const footprintKeys = new Set(footprint.map(coordinateKey));
    for (const cell of stagingCells) {
      if (!spatial.isPositionActive(cell) || !spatial.isWalkable(cell)) return false;
      if (isInsideFootprint(cell, candidate.footprint)) return false;
    }
    if (
      sortedCitizens().some(
        (citizen) =>
          footprintKeys.has(coordinateKey(citizen.position)) ||
          footprintKeys.has(coordinateKey(citizen.previousPosition)),
      )
    ) {
      developmentFootprintsRejected += 1;
      return false;
    }
    compactConsumedRoutePrefixes();
    spatial.blockMany(footprint);
    for (const cell of buildingClearanceZoneCells(candidate.footprint)) {
      clearanceCells.add(coordinateKey(cell));
    }
    clearAllDeadlockPairs();
    const project: ConstructionProjectState = {
      id: `construction-project-${String(nextConstructionProjectId)}`,
      buildingType: candidate.buildingType,
      footprint: { ...candidate.footprint },
      entrance: copyPosition(candidate.entrance),
      capacity: capacityForDevelopment(candidate.buildingType),
      phase: 'survey',
      phaseLaborCompleted: 0,
      phaseLaborRequired: constructionPhaseLaborRequired('survey', constructionPhaseDurations),
      phaseWorkerCap: constructionPhaseMaxWorkers('survey'),
      paused: true,
      phaseTicksRemaining: constructionPhaseDurations.survey,
      phaseTicksElapsed: 0,
      totalTicksElapsed: 0,
      ticksSinceLastLabor: 0,
      criticalBuilderId: null,
      criticalBuilderReason: null,
      startedTick: tick,
      score: candidate.score,
      primaryReason: { ...candidate.primaryReason },
      seedInfluence: candidate.seedInfluence,
      spatialFactor: candidate.spatialFactor,
      expectedAccessImprovement: candidate.expectedAccessImprovement,
      clearanceZone: buildingClearanceZone(candidate.footprint),
      stagingCells: stagingCells.map(copyPosition),
    };
    constructionProjects.push(project);
    nextConstructionProjectId += 1;
    constructionProjectsStarted += 1;
    developmentStateVersion += 1;
    replanAffectedRoutes(project.footprint);
    return true;
  };

  const completeConstructionProject = (
    project: ConstructionProjectState,
    workersAtCompletion: readonly CitizenState[],
  ): void => {
    for (const cell of footprintCells(project.footprint)) {
      if (!spatial.isPositionActive(cell)) {
        throw new Error(`Construction project ${project.id} leaves active space.`);
      }
    }
    const sequence = nextBuildingSequence[project.buildingType];
    const building: Building = {
      id: `${project.buildingType}-${String(sequence)}`,
      type: project.buildingType,
      footprint: { ...project.footprint },
      entrance: copyPosition(project.entrance),
      accessCells: completedBuildingAccessCells(project.footprint).map(copyPosition),
      capacity: project.capacity,
    };
    if (buildingsById.has(building.id))
      throw new Error(`Duplicate constructed building ${building.id}.`);
    buildings.push(building);
    buildingsById.set(building.id, building);
    for (const cell of buildingClearanceZoneCells(building.footprint)) {
      clearanceCells.add(coordinateKey(cell));
    }
    nextBuildingSequence[project.buildingType] = sequence + 1;
    constructionProjectsCompleted += 1;
    const workersById = [...workersAtCompletion].sort(compareCitizenIds);
    const releaseOccupancy = snapshotMovingOccupancy();
    const releaseWorkers = (): void => {
      for (const worker of workersById) releaseConstructionWorker(worker, releaseOccupancy);
    };
    releaseWorkers();

    if (project.buildingType === 'home') {
      // Assignment is an authoritative reference transition only. Preserve the
      // worker's physical position; never move a citizen to the new home.
      const unassigned = sortedCitizens().find((citizen) => citizen.homeBuildingId === null);
      if (unassigned !== undefined) {
        unassigned.homeBuildingId = building.id;
        unassigned.activity = 'idle';
        unassigned.activityTicksRemaining = 0;
        unassigned.departurePending = false;
        unassigned.route = [];
        unassigned.routeIndex = 0;
        unassigned.constructionCadenceTicks = 0;
      }
    } else if (project.buildingType === 'workplace') {
      const candidate = workersById.find(
        (citizen) =>
          citizen.homeBuildingId !== null &&
          citizen.workplaceBuildingId === null &&
          project.stagingCells.some((cell) => positionsEqual(cell, citizen.position)),
      );
      if (candidate !== undefined) {
        // Set both references as one transition. The worker remains at its
        // physical staging cell; it never snaps back to its home. Ordinary
        // work is entered immediately only on a valid workplace access cell.
        const homeBuildingId = candidate.homeBuildingId;
        candidate.homeBuildingId = homeBuildingId;
        candidate.workplaceBuildingId = building.id;
        candidate.departurePending = false;
        candidate.tripStartedTick = null;
        candidate.waitTicks = 0;
        candidate.constructionCadenceTicks = 0;
        const accessCells = (building.accessCells ?? [building.entrance]).map(copyPosition);
        const isAtAccess = accessCells.some((cell) => positionsEqual(candidate.position, cell));
        if (isAtAccess) {
          candidate.activity = 'work';
          candidate.activityTicksRemaining = activityDurationTicks;
          candidate.route = [];
          candidate.routeIndex = 0;
        } else {
          const route = findGridPathBetweenSets(
            {
              chunkSize,
              activeChunks: spatial.getActiveChunks(),
              isWalkable: (position) => isActiveLandWalkable(position),
              maxNodes: pathSearchBudget,
            },
            [candidate.position],
            accessCells,
            `${candidate.id}|physical-workplace|${building.id}`,
          );
          pathNodesExpanded += route.nodesExpanded;
          pathChunksTouched += route.chunksTouched;
          if (route.status === 'found' && route.path.length > 1) {
            candidate.activity = 'commuting-to-work';
            candidate.activityTicksRemaining = 0;
            candidate.route = route.path.map(copyPosition);
            candidate.routeIndex = 0;
            candidate.tripStartedTick = tick;
          } else {
            candidate.activity = 'idle';
            candidate.activityTicksRemaining = 0;
            candidate.route = [];
            candidate.routeIndex = 0;
          }
        }
      }
    }
    developmentStateVersion += 1;
    markAllDemandChunksDirty();
  };

  const constructionWorkers = (projectId: string): CitizenState[] =>
    sortedCitizens().filter((citizen) => citizen.constructionProjectId === projectId);

  const clearCriticalBuilder = (project: ConstructionProjectState): void => {
    const citizenId = project.criticalBuilderId;
    if (citizenId === null) {
      project.criticalBuilderReason = null;
      return;
    }
    const citizen = citizensById.get(citizenId);
    if (citizen?.criticalBuilderProjectId === project.id) {
      citizen.criticalBuilderProjectId = null;
      citizen.criticalBuilderReason = null;
    }
    project.criticalBuilderId = null;
    project.criticalBuilderReason = null;
    constructionCriticalClears += 1;
  };

  const clearCriticalForCitizen = (citizen: CitizenState): void => {
    const projectId = citizen.criticalBuilderProjectId;
    if (projectId === null) {
      citizen.criticalBuilderReason = null;
      return;
    }
    const project = constructionProjects.find((candidate) => candidate.id === projectId);
    citizen.criticalBuilderProjectId = null;
    citizen.criticalBuilderReason = null;
    if (project?.criticalBuilderId === citizen.id) {
      project.criticalBuilderId = null;
      project.criticalBuilderReason = null;
      constructionCriticalClears += 1;
    }
  };

  const criticalBuilderCandidates = (project: ConstructionProjectState): readonly CitizenState[] =>
    constructionWorkers(project.id)
      .filter(
        (citizen) =>
          citizen.activity === 'commuting-to-construction' &&
          citizen.tripStartedTick !== null &&
          citizen.route.length > 0 &&
          citizen.routeIndex < citizen.route.length - 1,
      )
      .sort((left, right) =>
        compareMovementProposals(
          {
            citizenId: left.id,
            waitTicks: left.waitTicks,
            remainingRouteCells: Math.max(0, left.route.length - left.routeIndex - 1),
            tripStartedTick: left.tripStartedTick ?? Number.MAX_SAFE_INTEGER,
            critical: false,
          },
          {
            citizenId: right.id,
            waitTicks: right.waitTicks,
            remainingRouteCells: Math.max(0, right.route.length - right.routeIndex - 1),
            tripStartedTick: right.tripStartedTick ?? Number.MAX_SAFE_INTEGER,
            critical: false,
          },
        ),
      );

  const designateCriticalBuilder = (project: ConstructionProjectState): void => {
    if (project.criticalBuilderId !== null) {
      const current = citizensById.get(project.criticalBuilderId);
      if (current !== undefined && criticalBuilderCandidates(project).includes(current)) return;
      clearCriticalBuilder(project);
    }
    const candidate = criticalBuilderCandidates(project)[0];
    if (candidate === undefined) {
      project.criticalBuilderReason =
        'No assigned reachable worker is available for critical movement priority.';
      constructionCriticalNoEligibleWorkerTicks += 1;
      return;
    }
    const reason = 'Lead builder prioritized after 12 zero-labor ticks.';
    candidate.criticalBuilderProjectId = project.id;
    candidate.criticalBuilderReason = reason;
    project.criticalBuilderId = candidate.id;
    project.criticalBuilderReason = reason;
    constructionCriticalPromotions += 1;
  };

  const releaseConstructionWorker = (
    citizen: CitizenState,
    movingOccupancy: Map<string, string> = new Map(),
  ): void => {
    const destinationId = citizen.resumeDestinationBuildingId;
    const resumeActivity = citizen.resumeActivity;
    if (destinationId === null || resumeActivity === null) {
      citizen.constructionProjectId = null;
      citizen.constructionStagingCell = null;
      citizen.constructionCadenceTicks = 0;
      citizen.resumeDestinationBuildingId = null;
      citizen.resumeActivity = null;
      citizen.activity = 'idle';
      citizen.departurePending = false;
      citizen.route = [];
      citizen.routeIndex = 0;
      citizen.waitTicks = 0;
      citizen.tripStartedTick = null;
      clearCriticalForCitizen(citizen);
      constructionWorkerReleases += 1;
      return;
    }
    citizen.constructionProjectId = null;
    citizen.constructionStagingCell = null;
    citizen.constructionCadenceTicks = 0;
    citizen.resumeDestinationBuildingId = null;
    citizen.resumeActivity = null;
    citizen.route = [];
    citizen.routeIndex = 0;
    citizen.waitTicks = 0;
    citizen.tripStartedTick = null;
    clearCriticalForCitizen(citizen);
    constructionWorkerReleases += 1;
    startTrip(citizen, resumeActivity, destinationId, movingOccupancy);
  };

  const retainConstructionWorkers = (
    project: ConstructionProjectState,
    maximumWorkers: number,
  ): void => {
    const workers = constructionWorkers(project.id);
    for (const worker of workers.slice(maximumWorkers)) releaseConstructionWorker(worker);
  };

  const advanceConstructionProjects = (): void => {
    const completedProjectIds: string[] = [];
    for (const project of [...constructionProjects].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )) {
      project.phaseTicksElapsed += 1;
      project.totalTicksElapsed += 1;
      const workers = constructionWorkers(project.id);
      const constructingWorkers = workers.filter((worker) => worker.activity === 'constructing');
      if (
        project.criticalBuilderId !== null &&
        !criticalBuilderCandidates(project).some(
          (worker) => worker.id === project.criticalBuilderId,
        )
      ) {
        clearCriticalBuilder(project);
      }
      project.paused = constructingWorkers.length === 0;
      if (project.paused) constructionPausedProjectTicks += 1;

      const remainingLabor = project.phaseLaborRequired - project.phaseLaborCompleted;
      let labor = 0;
      for (const worker of constructingWorkers) {
        worker.constructionCadenceTicks += 1;
        const eligible =
          worker.homeBuildingId !== null || worker.constructionCadenceTicks % 2 === 0;
        if (eligible) labor += 1;
      }
      labor = Math.min(remainingLabor, labor);
      if (labor > 0) {
        project.phaseLaborCompleted += labor;
        constructionLaborUnits += labor;
        project.ticksSinceLastLabor = 0;
        clearCriticalBuilder(project);
      } else {
        project.ticksSinceLastLabor += 1;
        if (project.ticksSinceLastLabor >= 12) designateCriticalBuilder(project);
      }
      if (project.phaseLaborCompleted < project.phaseLaborRequired) {
        project.phaseTicksRemaining = Math.max(
          1,
          Math.ceil(
            (project.phaseLaborRequired - project.phaseLaborCompleted) / project.phaseWorkerCap,
          ),
        );
        continue;
      }

      constructionPhaseCompletions += 1;
      clearCriticalBuilder(project);
      project.ticksSinceLastLabor = 0;
      const nextPhase = nextConstructionPhase(project.phase);
      if (nextPhase === undefined) {
        completeConstructionProject(project, constructionWorkers(project.id));
        completedProjectIds.push(project.id);
        continue;
      }
      project.phase = nextPhase;
      project.phaseLaborCompleted = 0;
      project.phaseLaborRequired = constructionPhaseLaborRequired(
        nextPhase,
        constructionPhaseDurations,
      );
      project.phaseWorkerCap = constructionPhaseMaxWorkers(nextPhase);
      project.paused = constructionWorkers(project.id).every(
        (worker) => worker.activity !== 'constructing',
      );
      project.phaseTicksRemaining = constructionPhaseDurations[nextPhase];
      project.phaseTicksElapsed = 0;
      retainConstructionWorkers(project, project.phaseWorkerCap);
      for (const worker of constructionWorkers(project.id)) worker.constructionCadenceTicks = 0;
      project.paused = constructionWorkers(project.id).every(
        (worker) => worker.activity !== 'constructing',
      );
    }
    for (const projectId of completedProjectIds) {
      const index = constructionProjects.findIndex((project) => project.id === projectId);
      if (index >= 0) constructionProjects.splice(index, 1);
    }
  };

  const growPopulation = (): boolean => {
    if (citizens.length >= populationCap) return false;
    const assignment = findNearestCompatiblePair({
      buildings,
      occupancy: occupancyByBuilding(),
      canUsePair: pairHasRoute,
    });
    if (assignment === undefined) return false;
    citizens.push(
      createCitizenState(
        `citizen-${String(nextCitizenSequence)}`,
        assignment.home,
        assignment.workplace,
      ),
    );
    const citizen = citizens.at(-1);
    if (citizen === undefined) throw new Error('A newly grown citizen was not stored.');
    citizensById.set(citizen.id, citizen);
    nextCitizenSequence += 1;
    return true;
  };

  const legacyEvaluateDevelopers = (): void => {
    /* Legacy monolithic evaluator retained in comments as a migration note.
    developmentEvaluations += 1;
    if (constructionProjects.length > 0) {
      lastDevelopmentCandidates = [];
      return;
    }
    if (lastEvaluatedDevelopmentStateVersion === developmentStateVersion) return;
    // A full seedless city has no unmet development signal. Avoid scanning
    // every active anchor in that steady state; seeded demand and capacity
    // pressure still enter the full deterministic evaluation below.
    if (seeds.length === 0 && calculateMetrics().metrics.space >= 1) {
      lastDevelopmentCandidates = [];
      lastEvaluatedDevelopmentStateVersion = developmentStateVersion;
      return;
    }

    const distances = reachableDistances();
    const occupancy = occupancyByBuilding();
    const ranked: DevelopmentCandidate[] = [];
    const activeChunks = spatial.getActiveChunks().sort(compareChunks);
    const protectedEntrances = [
      ...buildings.map((building) => building.entrance),
      ...constructionProjects.map((project) => project.entrance),
    ];
    const protectedPositions = citizens.map((citizen) => citizen.position);
    for (const buildingType of DEVELOPMENT_BUILDING_TYPE_ORDER) {
      for (const chunk of activeChunks) {
        const origin = {
          x: chunk.x * chunkSize,
          y: chunk.y * chunkSize,
        };
        for (let localY = 0; localY < chunkSize; localY += 1) {
          for (let localX = 0; localX < chunkSize; localX += 1) {
            const anchor = { x: origin.x + localX, y: origin.y + localY };
            const footprint = buildingFootprint(anchor, buildingType);
            const cells = footprintCells(footprint);
            if (
              cells.some((cell) => !spatial.isPositionActive(cell) || !spatial.isWalkable(cell)) ||
              protectedEntrances.some((entrance) => isInsideFootprint(entrance, footprint)) ||
              protectedPositions.some((position) => isInsideFootprint(position, footprint))
            ) {
              developmentFootprintsRejected += 1;
              continue;
            }
            const localMatchingDemand = demandValueAt(anchor, buildingType);
            const seedInfluence = matchingSeedInfluenceAt(anchor, buildingType);
            const complementaryUse = complementaryUseFactor(anchor, buildingType);
            const sameUseSaturation = localSameUseSaturation(anchor, buildingType, occupancy);
            const constructionCost = (footprint.width * footprint.height) / 25;
            const entrances = exteriorEntranceCandidates(footprint);
            for (const [entranceOrder, entrance] of entrances.entries()) {
              if (
                !spatial.isPositionActive(entrance) ||
                !spatial.isWalkable(entrance) ||
                distances.get(coordinateKey(entrance)) === undefined
              ) {
                developmentEntrancesRejected += 1;
                continue;
              }
              const entranceDistance = distances.get(coordinateKey(entrance));
              if (entranceDistance === undefined) {
                developmentEntrancesRejected += 1;
                continue;
              }
              const entranceAccessibility = normalizedDistance(
                entranceDistance,
                demandInfluenceRadius * 2,
              );
              const accessImprovement = expectedAccessImprovement(entrance, buildingType);
              const score = scoreDevelopmentCandidate({
                buildingType,
                localMatchingDemand,
                seedInfluence,
                complementaryUse,
                entranceAccessibility,
                expectedAccessImprovement: accessImprovement,
                sameUseSaturation,
                constructionCost,
              });
              developmentCandidatesScored += 1;
              if (score.score < developmentMinimumScore) continue;
              const candidate: DevelopmentCandidate = {
                buildingType,
                anchor: copyPosition(anchor),
                footprint: { ...footprint },
                entrance: copyPosition(entrance),
                entranceOrder,
                score: score.score,
                primaryReason: { ...score.primaryReason },
                localMatchingDemand: roundData(localMatchingDemand),
                seedInfluence: roundData(seedInfluence),
                complementaryUse: roundData(complementaryUse),
                entranceAccessibility: roundData(entranceAccessibility),
                expectedAccessImprovement: roundData(accessImprovement),
                sameUseSaturation: roundData(sameUseSaturation),
                constructionCost: roundData(constructionCost),
                spatialFactor: score.spatialFactor,
              };
              ranked.push(candidate);
              ranked.sort(compareDevelopmentCandidates);
              if (ranked.length > developmentCandidateSnapshotLimit) ranked.pop();
            }
          }
        }
      }
    }
    ranked.sort(compareDevelopmentCandidates);
    lastDevelopmentCandidates = ranked.map((candidate) => ({
      ...candidate,
      anchor: copyPosition(candidate.anchor),
      footprint: { ...candidate.footprint },
      entrance: copyPosition(candidate.entrance),
      primaryReason: { ...candidate.primaryReason },
    }));
    for (const candidate of ranked) {
      if (constructionProjects.length > 0) break;
      const before = constructionProjectsStarted;
      startConstruction(candidate);
      if (constructionProjectsStarted !== before) break;
    }
    lastEvaluatedDevelopmentStateVersion = developmentStateVersion;
    */
  };
  void legacyEvaluateDevelopers;

  const snapshotDevelopmentJob = (): DevelopmentJobProgress => {
    const job = developmentJob;
    if (job === undefined) {
      return { ...lastDevelopmentProgress };
    }
    return {
      stage: job.stage,
      stateVersion: job.stateVersion,
      relevantChunkCount: job.relevantChunks.length,
      chunkIndex: job.chunkIndex,
      buildingTypeIndex: job.buildingTypeIndex,
      anchorChecksThisTick: job.anchorChecksThisTick,
      preliminaryCandidatesRetained: job.preliminary.length,
      finalistsValidatedThisTick: job.finalistsValidatedThisTick,
      totalAnchorChecks: job.totalAnchorChecks,
      totalFinalistsValidated: job.totalFinalistsValidated,
    };
  };

  const gatherManualData = ():
    | { readonly accepted: true; readonly amount: 1 }
    | { readonly accepted: false; readonly reason: 'unavailable' } => {
    if (
      seeds.some((seed) => seed.kind === 'living') &&
      seeds.some((seed) => seed.kind === 'working')
    ) {
      return { accepted: false, reason: 'unavailable' };
    }
    data = roundData(data + 1);
    return { accepted: true, amount: 1 };
  };

  const finishDevelopmentJob = (stage: DevelopmentJobStage): void => {
    if (developmentJob !== undefined) {
      if (stage === 'complete') developmentJobsCompleted += 1;
      lastDevelopmentProgress = {
        stage,
        stateVersion: developmentJob.stateVersion,
        relevantChunkCount: developmentJob.relevantChunks.length,
        chunkIndex: developmentJob.chunkIndex,
        buildingTypeIndex: developmentJob.buildingTypeIndex,
        anchorChecksThisTick: developmentJob.anchorChecksThisTick,
        preliminaryCandidatesRetained: developmentJob.preliminary.length,
        finalistsValidatedThisTick: developmentJob.finalistsValidatedThisTick,
        totalAnchorChecks: developmentJob.totalAnchorChecks,
        totalFinalistsValidated: developmentJob.totalFinalistsValidated,
      };
    }
    developmentJob = undefined;
  };

  const startDevelopmentJob = (): void => {
    if (constructionProjects.length > 0) return;
    if (seeds.length === 0 && calculateMetrics().metrics.space >= 1 && !servicesCorePurchased) {
      lastDevelopmentCandidates = [];
      lastDevelopmentProgress = {
        ...lastDevelopmentProgress,
        stage: 'idle',
        stateVersion: developmentStateVersion,
      };
      return;
    }
    developmentEvaluations += 1;
    developmentJob = {
      stateVersion: developmentStateVersion,
      stage: 'enumerating',
      relevantChunks: relevantDevelopmentChunks(),
      buildingTypeIndex: 0,
      chunkIndex: 0,
      localX: 0,
      localY: 0,
      preliminary: [],
      finalistIndex: 0,
      totalAnchorChecks: 0,
      totalFinalistsValidated: 0,
      anchorChecksThisTick: 0,
      finalistsValidatedThisTick: 0,
    };
    developmentJobsStarted += 1;
  };

  const advanceDevelopmentJob = (triggerEvaluation: boolean): void => {
    if (developmentJob !== undefined && developmentJob.stateVersion !== developmentStateVersion) {
      developmentJobsSuperseded += 1;
      lastDevelopmentProgress = {
        ...lastDevelopmentProgress,
        stage: 'superseded',
        stateVersion: developmentJob.stateVersion,
      };
      developmentJob = undefined;
    }
    if (developmentJob === undefined && triggerEvaluation) startDevelopmentJob();
    const job = developmentJob;
    if (job === undefined || constructionProjects.length > 0) return;
    job.anchorChecksThisTick = 0;
    job.finalistsValidatedThisTick = 0;
    const occupancy = occupancyByBuilding();
    while (
      job.stage === 'enumerating' &&
      job.anchorChecksThisTick < defaults.developmentAnchorCheckBudget
    ) {
      const buildingType = DEVELOPMENT_BUILDING_TYPE_ORDER[job.buildingTypeIndex];
      const chunk = job.relevantChunks[job.chunkIndex];
      if (buildingType === undefined || chunk === undefined) {
        job.stage = 'validating';
        job.preliminary.sort(compareDevelopmentCandidates);
        lastDevelopmentCandidates = job.preliminary
          .slice(0, developmentCandidateSnapshotLimit)
          .map((candidate) => ({
            ...candidate,
            anchor: copyPosition(candidate.anchor),
            footprint: { ...candidate.footprint },
            entrance: copyPosition(candidate.entrance),
            primaryReason: { ...candidate.primaryReason },
            ...(candidate.clearanceZone === undefined
              ? {}
              : { clearanceZone: { ...candidate.clearanceZone } }),
            ...(candidate.stagingCells === undefined
              ? {}
              : { stagingCells: candidate.stagingCells.map(copyPosition) }),
          }));
        continue;
      }
      if (buildingType === 'service' && !servicesCorePurchased) {
        job.buildingTypeIndex += 1;
        job.chunkIndex = 0;
        job.localX = 0;
        job.localY = 0;
        continue;
      }
      const origin = { x: chunk.x * chunkSize, y: chunk.y * chunkSize };
      const anchor = { x: origin.x + job.localX, y: origin.y + job.localY };
      job.localX += 1;
      if (job.localX >= chunkSize) {
        job.localX = 0;
        job.localY += 1;
        if (job.localY >= chunkSize) {
          job.localY = 0;
          job.chunkIndex += 1;
          if (job.chunkIndex >= job.relevantChunks.length) {
            job.chunkIndex = 0;
            job.buildingTypeIndex += 1;
          }
        }
      }
      job.anchorChecksThisTick += 1;
      job.totalAnchorChecks += 1;
      developmentAnchorChecks += 1;
      const candidate = candidateFromAnchor(anchor, buildingType, occupancy);
      if (candidate !== undefined) retainPreliminaryCandidate(job.preliminary, candidate);
    }
    while (
      job.stage === 'validating' &&
      job.finalistsValidatedThisTick < defaults.developmentFinalistValidationBudget
    ) {
      const candidate = job.preliminary[job.finalistIndex];
      if (candidate === undefined) {
        finishDevelopmentJob('complete');
        break;
      }
      const validation = validateCandidateReachability(candidate);
      job.finalistIndex += 1;
      job.finalistsValidatedThisTick += 1;
      job.totalFinalistsValidated += 1;
      developmentFinalistValidations += 1;
      if (validation.status === 'unreachable') {
        developmentUnreachableRejections += 1;
        continue;
      }
      const before = constructionProjectsStarted;
      startConstruction(candidate);
      if (constructionProjectsStarted !== before) {
        const index = lastDevelopmentCandidates.findIndex(
          (entry) =>
            entry.buildingType === candidate.buildingType &&
            entry.anchor.x === candidate.anchor.x &&
            entry.anchor.y === candidate.anchor.y,
        );
        if (index >= 0) {
          const visible = lastDevelopmentCandidates[index];
          if (visible !== undefined) {
            lastDevelopmentCandidates[index] = {
              ...visible,
            };
          }
        }
        finishDevelopmentJob('complete');
        break;
      }
    }
    developmentPeakAnchorChecksPerTick = Math.max(
      developmentPeakAnchorChecksPerTick,
      job.anchorChecksThisTick,
    );
    developmentPeakFinalistValidationsPerTick = Math.max(
      developmentPeakFinalistValidationsPerTick,
      job.finalistsValidatedThisTick,
    );
    if (developmentJob !== undefined) {
      lastDevelopmentProgress = snapshotDevelopmentJob();
    }
  };

  const evaluateDevelopers = (triggerEvaluation: boolean): void => {
    advanceDevelopmentJob(triggerEvaluation);
  };

  const pairStateMatches = (state: DeadlockPairState, pair: MovementSwapPair): boolean =>
    state.key === pair.key &&
    state.leftId === pair.leftId &&
    state.rightId === pair.rightId &&
    positionsEqual(state.leftFrom, pair.leftFrom) &&
    positionsEqual(state.leftTo, pair.leftTo) &&
    positionsEqual(state.rightFrom, pair.rightFrom) &&
    positionsEqual(state.rightTo, pair.rightTo);

  const updateDeadlockPairStates = (
    directSwapPairs: readonly MovementSwapPair[],
    emergencySwapKeys: ReadonlySet<string>,
  ): void => {
    const activeKeys = new Set(directSwapPairs.map((pair) => pair.key));
    for (const key of [...deadlockPairStates.keys()]) {
      if (!activeKeys.has(key)) deadlockPairStates.delete(key);
    }
    for (const pair of directSwapPairs) {
      if (emergencySwapKeys.has(pair.key)) {
        deadlockPairStates.delete(pair.key);
        continue;
      }
      const previous = deadlockPairStates.get(pair.key);
      const blockedTicks =
        previous !== undefined && pairStateMatches(previous, pair) ? previous.blockedTicks + 1 : 1;
      deadlockPairStates.set(pair.key, {
        key: pair.key,
        leftId: pair.leftId,
        rightId: pair.rightId,
        leftFrom: copyPosition(pair.leftFrom),
        leftTo: copyPosition(pair.leftTo),
        rightFrom: copyPosition(pair.rightFrom),
        rightTo: copyPosition(pair.rightTo),
        blockedTicks,
      });
    }
  };

  const findConstructionRoute = (
    citizen: CitizenState,
    stagingCell: GridPosition,
  ): readonly GridPosition[] | undefined => {
    const result = findGridPathDetailed(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        // Endpoints stay uniquely assigned; transit may cross another
        // staging endpoint so a later worker is not made unreachable. The
        // movement resolver still blocks current occupants at each tick.
        isWalkable: (position) => isActiveLandWalkable(position),
        maxNodes: pathSearchBudget,
      },
      citizen.position,
      stagingCell,
    );
    pathNodesExpanded += result.nodesExpanded;
    pathChunksTouched += result.chunksTouched;
    return result.status === 'found' ? result.path.map(copyPosition) : undefined;
  };

  const assignConstructionWorkers = (movingOccupancy: Map<string, string>): void => {
    if (constructionProjects.length === 0) return;
    const eligibleCitizens = sortedCitizens().filter(
      (citizen) =>
        citizen.constructionProjectId === null &&
        citizen.constructionStagingCell === null &&
        citizen.resumeDestinationBuildingId === null &&
        (citizen.activity === 'home' ||
          citizen.activity === 'work' ||
          citizen.activity === 'idle') &&
        (citizen.activity === 'idle' ||
          (citizen.departurePending && citizen.activityTicksRemaining === 0)),
    );
    if (eligibleCitizens.length === 0) return;

    const offers: ConstructionRouteOffer[] = [];
    const projectCounts = new Map<string, number>();
    const reservedStaging = reservedConstructionStagingCells();
    for (const project of [...constructionProjects].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )) {
      const currentWorkerCount = constructionWorkers(project.id).length;
      projectCounts.set(project.id, currentWorkerCount);
      if (currentWorkerCount >= constructionPhaseMaxWorkers(project.phase)) continue;
      for (let stagingIndex = 0; stagingIndex < project.stagingCells.length; stagingIndex += 1) {
        const stagingCell = project.stagingCells[stagingIndex];
        if (stagingCell === undefined || reservedStaging.has(coordinateKey(stagingCell))) continue;
        for (const citizen of eligibleCitizens) {
          const route = findConstructionRoute(citizen, stagingCell);
          if (route === undefined) continue;
          offers.push({
            candidate: {
              projectId: project.id,
              routeLength: route.length - 1,
              stagingIndex,
              citizenId: citizen.id,
            },
            citizenId: citizen.id,
            projectId: project.id,
            stagingIndex,
            route,
          });
        }
      }
    }
    constructionAssignmentsOffered += offers.length;
    offers.sort((left, right) => compareConstructionAssignments(left.candidate, right.candidate));
    const assignedCitizens = new Set<string>();
    const assignedStaging = new Set<string>(reservedStaging);
    for (const offer of offers) {
      if (assignedCitizens.has(offer.citizenId)) continue;
      const project = constructionProjects.find((candidate) => candidate.id === offer.projectId);
      const stagingCell = project?.stagingCells[offer.stagingIndex];
      if (project === undefined || stagingCell === undefined) continue;
      const projectWorkerCount = projectCounts.get(project.id) ?? 0;
      if (projectWorkerCount >= constructionPhaseMaxWorkers(project.phase)) continue;
      const stagingKey = coordinateKey(stagingCell);
      if (assignedStaging.has(stagingKey)) continue;
      const citizen = citizensById.get(offer.citizenId);
      if (citizen === undefined)
        throw new Error(`Construction offer references ${offer.citizenId}.`);
      const originKey = coordinateKey(citizen.position);
      if (movingOccupancy.has(originKey)) continue;
      citizen.constructionProjectId = project.id;
      citizen.constructionStagingCell = copyPosition(stagingCell);
      citizen.constructionCadenceTicks = 0;
      citizen.resumeDestinationBuildingId =
        citizen.activity === 'home' ? citizen.workplaceBuildingId : citizen.homeBuildingId;
      citizen.resumeActivity =
        citizen.activity === 'home'
          ? 'commuting-to-work'
          : citizen.activity === 'work'
            ? 'commuting-home'
            : null;
      citizen.activity = 'commuting-to-construction';
      citizen.departurePending = false;
      citizen.route = offer.route.map(copyPosition);
      citizen.routeIndex = 0;
      citizen.tripStartedTick = tick;
      citizen.waitTicks = 0;
      clearCriticalForCitizen(citizen);
      assignedCitizens.add(citizen.id);
      assignedStaging.add(stagingKey);
      projectCounts.set(project.id, projectWorkerCount + 1);
      movingOccupancy.set(originKey, citizen.id);
      constructionAssignmentsAccepted += 1;
    }
  };

  const chooseServiceDestination = (
    citizen: CitizenState,
  ): ServiceDestinationCandidate | undefined => {
    const occupancy = occupancyByBuilding();
    const candidates: ServiceDestinationCandidate[] = [];
    const serviceBuildings = buildings
      .filter(
        (building): building is Building & { readonly type: 'service' } =>
          building.type === 'service',
      )
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    for (const building of serviceBuildings) {
      const occupied = occupancy.get(building.id) ?? 0;
      if (occupied >= building.capacity) continue;
      const sourceBuilding =
        citizen.homeBuildingId === null ? undefined : buildingsById.get(citizen.homeBuildingId);
      const route = findGridPathBetweenSets(
        {
          chunkSize,
          activeChunks: spatial.getActiveChunks(),
          isWalkable: (position) => isActiveLandWalkable(position),
          maxNodes: pathSearchBudget,
        },
        sourceBuilding?.accessCells ?? [citizen.position],
        building.accessCells ?? [building.entrance],
        `${citizen.id}|${citizen.homeBuildingId ?? 'physical'}|${building.id}`,
      );
      pathNodesExpanded += route.nodesExpanded;
      pathChunksTouched += route.chunksTouched;
      if (route.status !== 'found') continue;
      const routeLength = route.path.length - 1;
      const occupancyRatio =
        building.capacity === 0 ? 1 : Math.max(0, Math.min(1, occupied / building.capacity));
      const score = scoreServiceDestination({
        serviceNeed: citizen.serviceNeed,
        routeLength,
        occupancyRatio,
      });
      candidates.push({
        building,
        routeLength,
        occupancyRatio,
        score: score.score,
        primaryReason: score.primaryReason,
      });
    }
    return selectServiceDestination(candidates);
  };

  const advanceCitizenSchedules = (movingOccupancy: Map<string, string>): void => {
    const boundaryCitizens: CitizenState[] = [];
    for (const citizen of sortedCitizens()) {
      if (citizen.activity === 'service') {
        if (citizen.activityTicksRemaining > 0) citizen.activityTicksRemaining -= 1;
        if (citizen.activityTicksRemaining === 0) completeServiceUse(citizen);
        continue;
      }
      if (citizen.activity !== 'home' && citizen.activity !== 'work') continue;
      if (citizen.activityTicksRemaining > 0) citizen.activityTicksRemaining -= 1;
      if (citizen.activityTicksRemaining > 0) continue;
      if (!citizen.departurePending) {
        citizen.departurePending = true;
        if (citizen.activity === 'work') {
          citizen.serviceNeed = Math.min(SERVICE_NEED_MAX, citizen.serviceNeed + 1);
          completedWorkActivities += 1;
          completedActivities += 1;
        }
      }
      boundaryCitizens.push(citizen);
    }
    assignConstructionWorkers(movingOccupancy);
    for (const citizen of boundaryCitizens) {
      if (citizen.constructionProjectId !== null) continue;
      const originKey = coordinateKey(citizen.position);
      if (movingOccupancy.has(originKey)) continue;
      if (
        citizen.activity === 'home' &&
        servicesCorePurchased &&
        citizen.serviceNeed >= SERVICE_NEED_THRESHOLD
      ) {
        const service = chooseServiceDestination(citizen);
        if (service !== undefined) {
          citizen.serviceDestinationBuildingId = service.building.id;
          citizen.serviceDestinationReason = service.primaryReason;
          if (!startTrip(citizen, 'commuting-to-service', service.building.id, movingOccupancy)) {
            citizen.serviceDestinationBuildingId = null;
            citizen.serviceDestinationReason = null;
          }
          continue;
        }
        failedServiceDestinationAttempts += 1;
        serviceWaitTicks += 1;
        citizen.serviceWaitTicks += 1;
      }
      const activity: CitizenActivity =
        citizen.activity === 'home' ? 'commuting-to-work' : 'commuting-home';
      const destinationId =
        activity === 'commuting-to-work' ? citizen.workplaceBuildingId : citizen.homeBuildingId;
      if (destinationId === null) {
        citizen.activity = 'idle';
        citizen.departurePending = false;
        continue;
      }
      startTrip(citizen, activity, destinationId, movingOccupancy);
    }
  };

  const replanCitizen = (
    citizen: CitizenState,
    movingOccupancy: ReadonlyMap<string, string>,
    waitTicksAtStart: ReadonlyMap<string, number>,
    recovery = true,
  ): boolean => {
    const isConstructionCommute = citizen.activity === 'commuting-to-construction';
    const destinationId = isConstructionCommute
      ? citizen.constructionProjectId
      : citizen.activity === 'commuting-to-work'
        ? citizen.workplaceBuildingId
        : citizen.activity === 'commuting-to-service'
          ? citizen.serviceDestinationBuildingId
          : citizen.homeBuildingId;
    if (destinationId === null) {
      throw new Error(`Construction commuter ${citizen.id} has no project destination.`);
    }
    const project = isConstructionCommute
      ? constructionProjects.find((candidate) => candidate.id === destinationId)
      : undefined;
    if (
      isConstructionCommute &&
      (project === undefined || citizen.constructionStagingCell === null)
    ) {
      throw new Error(`Construction commuter ${citizen.id} has an invalid project assignment.`);
    }
    const constructionDestination =
      project === undefined || citizen.constructionStagingCell === null
        ? undefined
        : citizen.constructionStagingCell;
    const destination = constructionDestination ?? buildingById(destinationId).entrance;
    const temporaryBlocked = new Set(movingOccupancy.keys());
    temporaryBlocked.delete(coordinateKey(citizen.position));
    temporaryBlocked.delete(coordinateKey(destination));
    movementReplansAttempted += 1;
    const result = replanMovementRoute({
      chunkSize,
      activeChunks: spatial.getActiveChunks(),
      start: citizen.position,
      goal: destination,
      currentRoute: citizen.route,
      currentRouteIndex: citizen.routeIndex,
      temporaryBlocked,
      isWalkable: (position) => isActiveLandWalkable(position),
      maxNodes: pathSearchBudget,
      recovery,
      orthogonalQueueNeighbors: (position) => {
        let neighbors = 0;
        for (const direction of [
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: -1, y: 0 },
          { x: 0, y: -1 },
        ] as const) {
          const neighbor = { x: position.x + direction.x, y: position.y + direction.y };
          const occupantId = movingOccupancy.get(coordinateKey(neighbor));
          if (
            occupantId !== undefined &&
            occupantId !== citizen.id &&
            (waitTicksAtStart.get(occupantId) ?? 0) > 0
          ) {
            neighbors += 1;
          }
        }
        return neighbors;
      },
    });
    pathNodesExpanded += result.nodesExpanded;
    pathChunksTouched += result.chunksTouched;
    if (result.status !== 'found') return false;
    if (!result.routeChanged) {
      movementReplansUnchanged += 1;
      return false;
    }
    const replannedRoute = result.path.map(copyPosition);
    clearCriticalForCitizen(citizen);
    citizen.route = replannedRoute;
    citizen.routeIndex = result.routeIndex;
    movementReplansSucceeded += 1;
    clearDeadlockPairsForCitizen(citizen.id);
    return true;
  };

  const maybeReplanBlockedCitizens = (
    blockedIds: readonly string[],
    startOfTickOccupancy: ReadonlyMap<string, string>,
    waitTicksAtStart: ReadonlyMap<string, number>,
  ): void => {
    if (blockedIds.length === 0) return;
    const orderedIds = [...blockedIds].sort();
    for (const citizenId of orderedIds) {
      const citizen = citizensById.get(citizenId);
      if (citizen === undefined) throw new Error(`Blocked movement references ${citizenId}.`);
      if (!isMovementReplanDue(citizen.waitTicks)) continue;
      replanCitizen(citizen, startOfTickOccupancy, waitTicksAtStart);
    }
  };

  const advanceCitizens = (): void => {
    const movingOccupancy = snapshotMovingOccupancy();
    const startOfTickOccupancy = new Map(movingOccupancy);
    const waitTicksAtStart = new Map<string, number>();
    for (const citizenId of startOfTickOccupancy.values()) {
      const citizen = citizensById.get(citizenId);
      if (citizen !== undefined) waitTicksAtStart.set(citizen.id, citizen.waitTicks);
    }
    const initiallyMovingCitizenIds = new Set(movingOccupancy.values());
    for (const citizen of sortedCitizens()) {
      citizen.previousPosition = copyPosition(citizen.position);
    }
    advanceCitizenSchedules(movingOccupancy);

    const candidates: MovementCandidate[] = [];
    for (const citizen of sortedCitizens()) {
      const isCommute =
        citizen.activity === 'commuting-to-work' ||
        citizen.activity === 'commuting-home' ||
        citizen.activity === 'commuting-to-service' ||
        citizen.activity === 'commuting-to-construction';
      if (!isCommute) continue;
      // A newly scheduled trip claims its origin for this tick and becomes
      // proposal-eligible on the next tick, preserving a distinct trip start.
      if (!initiallyMovingCitizenIds.has(citizen.id)) continue;
      if (citizen.tripStartedTick === null) {
        throw new Error(`Commuter ${citizen.id} has no trip start tick.`);
      }
      candidates.push({
        id: citizen.id,
        position: copyPosition(citizen.position),
        route: citizen.route.map(copyPosition),
        routeIndex: citizen.routeIndex,
        waitTicks: citizen.waitTicks,
        tripStartedTick: citizen.tripStartedTick,
        critical: citizen.criticalBuilderProjectId !== null,
      });
    }
    const proposals = buildMovementProposals({
      candidates,
      isActive: (position) => spatial.isPositionActive(position),
      isWalkable: (position) => isActiveLandWalkable(position),
    });
    movementProposals += proposals.length;
    const directSwapPairs = findDirectMovementSwapPairs(proposals);
    const emergencySwapPairs = new Set<string>();
    for (const pair of directSwapPairs) {
      const previous = deadlockPairStates.get(pair.key);
      const leftCitizen = citizensById.get(pair.leftId);
      const rightCitizen = citizensById.get(pair.rightId);
      if (leftCitizen === undefined || rightCitizen === undefined) {
        throw new Error(`Movement swap references an unknown citizen ${pair.key}.`);
      }
      if (
        (previous !== undefined &&
          pairStateMatches(previous, pair) &&
          isMovementDeadlockRecoveryDue(previous.blockedTicks, true)) ||
        (leftCitizen.waitTicks >= MOVEMENT_DEADLOCK_RECOVERY_BLOCKED_TICKS - 1 &&
          rightCitizen.waitTicks >= MOVEMENT_DEADLOCK_RECOVERY_BLOCKED_TICKS - 1)
      ) {
        emergencySwapPairs.add(pair.key);
      }
    }
    const resolution = resolveMovementReservations({
      proposals,
      movingOccupancy,
      emergencySwapPairs,
    });
    movementCommittedMoves += resolution.accepted.length;
    movementBlockedMoves += resolution.blocked.length;
    movementTargetConflicts += resolution.targetConflicts;
    movementDependencyBlocks += resolution.dependencyBlocks;
    movementCyclesCommitted += resolution.cyclesCommitted;
    movementOrdinarySwapsRejected += resolution.ordinarySwapsRejected;
    movementDeadlockRecoveries += resolution.emergencySwaps;
    movementCriticalPriorityWins += resolution.criticalPriorityWins;
    constructionCriticalConflictWins += resolution.criticalPriorityWins;

    for (const move of resolution.accepted) {
      const citizen = citizensById.get(move.citizenId);
      if (citizen === undefined)
        throw new Error(`Committed movement references ${move.citizenId}.`);
      const expectedNext = citizen.route[citizen.routeIndex + 1];
      if (expectedNext === undefined || !positionsEqual(expectedNext, move.to)) {
        throw new Error(`Committed movement is not the next route cell for ${citizen.id}.`);
      }
      citizen.position = copyPosition(move.to);
      citizen.routeIndex += 1;
      if (citizen.activity === 'commuting-to-construction') constructionCommutes += 1;
      traffic.recordCommittedMove(move.from, move.to);
    }
    for (const blocked of resolution.blocked) {
      const citizen = citizensById.get(blocked.citizenId);
      if (citizen === undefined)
        throw new Error(`Blocked movement references ${blocked.citizenId}.`);
      citizen.waitTicks += 1;
      if (citizen.activity === 'commuting-to-service') {
        citizen.serviceWaitTicks += 1;
        serviceWaitTicks += 1;
      }
    }
    for (const move of resolution.accepted) {
      const citizen = citizensById.get(move.citizenId);
      if (citizen === undefined)
        throw new Error(`Committed movement references ${move.citizenId}.`);
      citizen.waitTicks = 0;
    }

    for (const move of resolution.accepted) {
      const citizen = citizensById.get(move.citizenId);
      if (citizen === undefined)
        throw new Error(`Committed movement references ${move.citizenId}.`);
      if (citizen.routeIndex !== citizen.route.length - 1) continue;
      if (citizen.activity === 'commuting-to-construction') {
        completeConstructionCommute(citizen);
      } else {
        const destinationId =
          citizen.activity === 'commuting-to-work'
            ? citizen.workplaceBuildingId
            : citizen.activity === 'commuting-to-service'
              ? citizen.serviceDestinationBuildingId
              : citizen.homeBuildingId;
        if (destinationId === null) {
          throw new Error(`Citizen ${citizen.id} completed service commute without a destination.`);
        }
        if (citizen.activity === 'commuting-to-service') {
          completeServiceTrip(citizen, destinationId);
        } else {
          completeTrip(citizen, destinationId);
        }
      }
    }

    for (const move of resolution.accepted) clearDeadlockPairsForCitizen(move.citizenId);
    updateDeadlockPairStates(resolution.directSwapPairs, emergencySwapPairs);
    const blockedIds = resolution.blocked.map(({ citizenId }) => citizenId);
    maybeReplanBlockedCitizens(blockedIds, startOfTickOccupancy, waitTicksAtStart);
    if (resolution.accepted.length === 0 && blockedIds.length === 0) clearAllDeadlockPairs();
  };

  const demandSnapshot = (): {
    readonly demand: SimulationSnapshot['demand'];
    readonly activeChunks: readonly ActiveChunkSnapshot[];
  } => {
    const activeChunks: ActiveChunkSnapshot[] = [];
    let totals = zeroTotals();
    for (const chunk of spatial.getActiveChunks()) {
      const state = demandChunks.get(chunkKey(chunk));
      if (state?.dirty === true || state?.values === undefined) {
        throw new Error(`Active chunk ${chunkKey(chunk)} has no evaluated demand buffer.`);
      }
      totals = {
        living: totals.living + state.totals.living,
        working: totals.working + state.totals.working,
        services: totals.services + state.totals.services,
      };
      activeChunks.push({
        chunk: copyChunk(chunk),
        key: chunkKey(chunk),
        occupancyRevision: spatial.getChunkRevision(chunk),
        demandRevision: state.revision,
        occupancyBufferAllocated: spatial.hasOccupancyBuffer(chunk),
        staticTopologyRevision: spatial.getStaticTopologyRevision(chunk),
      });
    }
    const summaries = activeChunks.map((activeChunk) => {
      const state = demandChunks.get(activeChunk.key);
      if (state === undefined) throw new Error(`Missing demand state ${activeChunk.key}.`);
      return {
        chunk: copyChunk(activeChunk.chunk),
        key: activeChunk.key,
        revision: state.revision,
        cellCount: chunkSize * chunkSize,
        totals: copyTotals(state.totals),
      };
    });
    return {
      demand: {
        totals: {
          living: Math.round(totals.living * 1_000_000) / 1_000_000,
          working: Math.round(totals.working * 1_000_000) / 1_000_000,
          services: Math.round(totals.services * 1_000_000) / 1_000_000,
        },
        chunks: summaries,
      },
      activeChunks,
    };
  };

  const snapshot = (): SimulationSnapshot => {
    assertPopulationInvariants();
    const { metrics, averageTripDurationTicks } = calculateMetrics();
    const demand = demandSnapshot();
    const trafficSnapshot = traffic.getSnapshot();
    const trafficCounters = traffic.getCounters();
    const structural: SimulationStructuralCounters = {
      activeChunks: demand.activeChunks.length,
      allocatedChunks: demand.activeChunks.length,
      allocatedOccupancyBuffers: spatial.getAllocatedOccupancyBufferCount(),
      allocatedDemandBuffers: [...demandChunks.values()].filter(
        (state) => state.values !== undefined,
      ).length,
      demandChunksDirtied,
      demandChunksEvaluated,
      pathNodesExpanded,
      pathChunksTouched,
      snapshotChunkSummaries: demand.activeChunks.length,
      developmentEvaluations,
      developmentCandidatesScored,
      developmentFootprintsRejected,
      developmentEntrancesRejected,
      constructionProjectsStarted,
      constructionProjectsCompleted,
      activeTrafficEdges: trafficCounters.activeEdges,
      trafficTraversalEventsRecorded: trafficCounters.traversalEventsRecorded,
      trafficExpiredTraversalEvents: trafficCounters.expiredTraversalEvents,
      trafficExpiredBuckets: trafficCounters.expiredBuckets,
      trafficPeakActiveEdges: trafficCounters.peakActiveEdges,
      movementProposals,
      movementCommittedMoves,
      movementBlockedMoves,
      movementTargetConflicts,
      movementDependencyBlocks,
      movementCyclesCommitted,
      movementOrdinarySwapsRejected,
      movementReplansAttempted,
      movementReplansSucceeded,
      movementReplansUnchanged,
      movementDeadlockRecoveries,
      movementCriticalPriorityWins,
      staticTopologyRevision: spatial.getStaticTopologyRevisionTotal(),
      developmentJobsStarted,
      developmentJobsSuperseded,
      developmentJobsCompleted,
      developmentAnchorChecks,
      developmentPreliminaryCandidatesRetained,
      developmentFinalistValidations,
      developmentUnreachableRejections,
      developmentAffectedRouteReplans,
      developmentRoutePreservationChecks,
      developmentPeakAnchorChecksPerTick,
      developmentPeakFinalistValidationsPerTick,
      constructionAssignmentsOffered,
      constructionAssignmentsAccepted,
      constructionCommutes,
      constructionWorkerArrivals,
      constructionLaborUnits,
      constructionPausedProjectTicks,
      constructionPhaseCompletions,
      constructionWorkerReleases,
      constructionCriticalPromotions,
      constructionCriticalClears,
      constructionCriticalNoEligibleWorkerTicks,
      constructionCriticalConflictWins,
      serviceTrips,
      serviceUses,
      failedServiceDestinationAttempts,
      serviceWaitTicks,
    };
    const currentCore = servicesCoreState();
    return {
      chunkSize,
      activeChunkCount: demand.activeChunks.length,
      activeChunks: demand.activeChunks,
      seed,
      tick,
      randomState: random.getState(),
      trafficHistoryWindowTicks,
      populationCap,
      populationGrowthCadenceTicks,
      completedTrips,
      completedActivities,
      completedWorkActivities,
      completedServiceActivities,
      serviceTrips,
      serviceUses,
      failedServiceDestinationAttempts,
      serviceWaitTicks,
      data,
      manualDataAvailable: !(
        seeds.some((seed) => seed.kind === 'living') &&
        seeds.some((seed) => seed.kind === 'working')
      ),
      dataGeneratedThisTick,
      dataGeneratedThisTickBySource: { ...dataGeneratedThisTickBySource },
      dataBySource: { ...dataBySource },
      averageTripDurationTicks,
      metrics,
      core: {
        servicesCore: {
          ...currentCore,
          requirements: currentCore.requirements.map((requirement) => ({ ...requirement })),
          missingRequirements: [...currentCore.missingRequirements],
        },
      },
      servicesCore: {
        ...currentCore,
        requirements: currentCore.requirements.map((requirement) => ({ ...requirement })),
        missingRequirements: [...currentCore.missingRequirements],
      },
      researchFocus: selectedResearchFocus,
      demand: {
        totals: { ...demand.demand.totals },
        chunks: demand.demand.chunks.map((chunk) => ({
          ...chunk,
          chunk: copyChunk(chunk.chunk),
          totals: copyTotals(chunk.totals),
        })),
      },
      traffic: trafficSnapshot.map((edge) => ({
        key: edge.key,
        a: copyPosition(edge.a),
        b: copyPosition(edge.b),
        aToB: edge.aToB,
        bToA: edge.bToA,
        total: edge.total,
      })),
      structural,
      districtSeedDefinitions: simulationDistrictSeedDefinitions().map((definition) => ({
        ...definition,
      })),
      developmentJob: snapshotDevelopmentJob(),
      seeds: seeds.map((districtSeed) => ({
        ...districtSeed,
        position: copyPosition(districtSeed.position),
      })),
      buildings: buildings.map((building) => ({
        ...building,
        footprint: { ...building.footprint },
        entrance: copyPosition(building.entrance),
        ...(building.accessCells === undefined
          ? {}
          : { accessCells: building.accessCells.map(copyPosition) }),
      })),
      occupancy: occupancySnapshot().map((building) => ({ ...building })),
      citizens: sortedCitizens().map((citizen): CitizenSnapshot => ({
        id: citizen.id,
        position: copyPosition(citizen.position),
        previousPosition: copyPosition(citizen.previousPosition),
        homeBuildingId: citizen.homeBuildingId,
        workplaceBuildingId: citizen.workplaceBuildingId,
        activity: citizen.activity,
        activityTicksRemaining: citizen.activityTicksRemaining,
        serviceNeed: citizen.serviceNeed,
        serviceDestinationBuildingId: citizen.serviceDestinationBuildingId,
        serviceDestinationReason: citizen.serviceDestinationReason,
        serviceWaitTicks: citizen.serviceWaitTicks,
        route: citizen.route.map(copyPosition),
        routeIndex: citizen.routeIndex,
        waitTicks: citizen.waitTicks,
        constructionProjectId: citizen.constructionProjectId,
        constructionStagingCell:
          citizen.constructionStagingCell === null
            ? null
            : copyPosition(citizen.constructionStagingCell),
        constructionCadenceTicks: citizen.constructionCadenceTicks,
        resumeDestinationBuildingId: citizen.resumeDestinationBuildingId,
        criticalBuilderProjectId: citizen.criticalBuilderProjectId,
        criticalBuilderReason: citizen.criticalBuilderReason,
      })),
      developmentCandidates: lastDevelopmentCandidates.map((candidate) => ({
        ...candidate,
        anchor: copyPosition(candidate.anchor),
        footprint: { ...candidate.footprint },
        entrance: copyPosition(candidate.entrance),
        primaryReason: { ...candidate.primaryReason },
        ...(candidate.clearanceZone === undefined
          ? {}
          : { clearanceZone: { ...candidate.clearanceZone } }),
        ...(candidate.stagingCells === undefined
          ? {}
          : { stagingCells: candidate.stagingCells.map(copyPosition) }),
      })),
      constructionProjects: constructionProjects.map((project): ConstructionProject => ({
        id: project.id,
        buildingType: project.buildingType,
        footprint: { ...project.footprint },
        entrance: copyPosition(project.entrance),
        capacity: project.capacity,
        phase: project.phase,
        phaseLaborCompleted: project.phaseLaborCompleted,
        phaseLaborRequired: project.phaseLaborRequired,
        workerCount: constructionWorkers(project.id).length,
        paused: project.paused,
        phaseTicksRemaining: project.phaseTicksRemaining,
        phaseTicksElapsed: project.phaseTicksElapsed,
        totalTicksElapsed: project.totalTicksElapsed,
        ticksSinceLastLabor: project.ticksSinceLastLabor,
        criticalBuilderId: project.criticalBuilderId,
        criticalBuilderReason: project.criticalBuilderReason,
        startedTick: project.startedTick,
        score: project.score,
        primaryReason: { ...project.primaryReason },
        seedInfluence: project.seedInfluence,
        spatialFactor: project.spatialFactor,
        expectedAccessImprovement: project.expectedAccessImprovement,
        clearanceZone: { ...project.clearanceZone },
        stagingCells: project.stagingCells.map(copyPosition),
      })),
    };
  };

  const api: Simulation = {
    gatherManualData,
    step(): void {
      const metricsBefore = calculateMetrics().metrics;
      const activitiesBefore = completedActivities;
      const workActivitiesBefore = completedWorkActivities;
      const serviceActivitiesBefore = completedServiceActivities;
      const serviceTripsBefore = serviceTrips;
      const serviceNeedBefore = citizens.reduce((total, citizen) => total + citizen.serviceNeed, 0);
      const serviceReservationsBefore = citizens.reduce(
        (total, citizen) => total + (citizen.serviceDestinationBuildingId === null ? 0 : 1),
        0,
      );
      tick += 1;
      traffic.advanceToTick(tick);
      advanceCitizens();
      advanceConstructionProjects();
      const populationGrew = tick % populationGrowthCadenceTicks === 0 ? growPopulation() : false;
      const metricsAfter = calculateMetrics().metrics;
      const serviceStateChanged =
        serviceActivitiesBefore !== completedServiceActivities ||
        serviceTripsBefore !== serviceTrips ||
        serviceReservationsBefore !==
          citizens.reduce(
            (total, citizen) => total + (citizen.serviceDestinationBuildingId === null ? 0 : 1),
            0,
          ) ||
        serviceNeedBefore !== citizens.reduce((total, citizen) => total + citizen.serviceNeed, 0);
      if (populationGrew || serviceStateChanged || !sameMetrics(metricsBefore, metricsAfter)) {
        markAllDemandChunksDirty();
        if (populationGrew) developmentStateVersion += 1;
      }
      const activitiesCompletedThisTick = completedActivities - activitiesBefore;
      const workActivitiesCompletedThisTick = completedWorkActivities - workActivitiesBefore;
      const serviceActivitiesCompletedThisTick =
        completedServiceActivities - serviceActivitiesBefore;
      dataGeneratedThisTick = 0;
      const efficiency = dataEfficiency(metricsAfter);
      const workData = roundData(Math.max(0, workActivitiesCompletedThisTick) * efficiency);
      const serviceData = roundData(Math.max(0, serviceActivitiesCompletedThisTick) * efficiency);
      dataGeneratedThisTickBySource = { work: workData, service: serviceData };
      dataGeneratedThisTick = roundData(workData + serviceData);
      dataBySource = {
        work: roundData(dataBySource.work + workData),
        service: roundData(dataBySource.service + serviceData),
      };
      if (activitiesCompletedThisTick > 0) data = roundData(data + dataGeneratedThisTick);
      refreshDirtyDemandChunks();
      evaluateDevelopers(tick % developmentEvaluationIntervalTicks === 0);
      assertPopulationInvariants();
    },
    getDistrictSeedDefinitions(): readonly DistrictSeedDefinition[] {
      return simulationDistrictSeedDefinitions().map((definition) => ({ ...definition }));
    },
    getDistrictSeedDefinition(kind: DistrictSeedKind): DistrictSeedDefinition {
      return simulationDistrictSeedDefinition(kind);
    },
    getDistrictSeedPlacementInfo(command: PlaceDistrictSeedCommand): DistrictSeedPlacementInfo {
      return districtSeedPlacementInfo(command);
    },
    previewDistrictSeed(command: PlaceDistrictSeedCommand): DistrictSeedPlacementPreview {
      const info = districtSeedPlacementInfo(command);
      return info.valid
        ? { valid: true, cost: info.cost }
        : { valid: false, reason: info.reason ?? 'invalid-kind' };
    },
    placeDistrictSeed(command: PlaceDistrictSeedCommand): CommandResult {
      const validation = validateDistrictSeedPlacement(command);
      if (!validation.accepted) return validation;
      const districtSeed: DistrictSeed = {
        id: `district-seed-${String(nextSeedId)}`,
        kind: validation.kind,
        position: copyPosition(validation.position),
      };
      seeds.push(districtSeed);
      nextSeedId += 1;
      data = roundData(data - validation.cost);
      developmentStateVersion += 1;
      markDemandAroundPosition(validation.position);
      refreshDirtyDemandChunks();
      return {
        accepted: true,
        seed: { ...districtSeed, position: copyPosition(districtSeed.position) },
        cost: validation.cost,
      };
    },
    activateChunk(command: ActivateChunkCommand): ChunkActivationResult {
      if (!Number.isSafeInteger(command.x) || !Number.isSafeInteger(command.y)) {
        return { accepted: false, reason: 'invalid-chunk' };
      }
      const requested = { x: command.x, y: command.y };
      if (spatial.isActive(requested)) {
        return { accepted: false, reason: 'already-active' };
      }
      if (!spatial.getActiveChunks().some((chunk) => adjacentChunks(chunk, requested))) {
        return { accepted: false, reason: 'not-adjacent' };
      }
      if (spatial.getActiveChunks().length >= activeChunkLimit) {
        return { accepted: false, reason: 'active-chunk-limit' };
      }
      spatial.activate(requested);
      clearAllDeadlockPairs();
      developmentStateVersion += 1;
      markDemandForActivation(requested);
      refreshDirtyDemandChunks();
      return {
        accepted: true,
        chunk: copyChunk(requested),
        activeChunkCount: spatial.getActiveChunks().length,
      };
    },
    getCurrentDistrictSeedCost(kind: DistrictSeedKind): number {
      return currentDistrictSeedCost(kind);
    },
    getCoreState(): CoreState {
      const state = coreState();
      return {
        servicesCore: {
          ...state.servicesCore,
          requirements: state.servicesCore.requirements.map((requirement) => ({ ...requirement })),
          missingRequirements: [...state.servicesCore.missingRequirements],
        },
      };
    },
    getServicesCoreState(): ServicesCoreState {
      const state = servicesCoreState();
      return {
        ...state,
        requirements: state.requirements.map((requirement) => ({ ...requirement })),
        missingRequirements: [...state.missingRequirements],
      };
    },
    getCorePurchaseInfo(core: CoreProtocol = 'services'): CorePurchaseInfo {
      return corePurchaseInfo(core);
    },
    previewCorePurchase(command: PurchaseCoreCommand): CorePurchaseInfo & {
      readonly reason?: CorePurchaseRejectionReason;
    } {
      const requestedCore: unknown = (command as { readonly core?: unknown }).core;
      if (requestedCore !== undefined && requestedCore !== 'services') {
        return { ...corePurchaseInfo(), reason: 'invalid-focus' };
      }
      const info = corePurchaseInfo();
      if (!isResearchFocus(command.focus)) return { ...info, reason: 'invalid-focus' };
      if (servicesCorePurchased) return { ...info, reason: 'already-purchased' };
      if (info.missingRequirements.length > 0) {
        return { ...info, reason: 'missing-prerequisites' };
      }
      if (data < SERVICES_CORE_COST) return { ...info, reason: 'insufficient-data' };
      return { ...info };
    },
    purchaseCore(command: PurchaseCoreCommand): CorePurchaseResult {
      return purchaseCore(command);
    },
    purchaseServicesCore(focusOrCommand: ResearchFocus | PurchaseCoreCommand): CorePurchaseResult {
      return purchaseCore(
        typeof focusOrCommand === 'string'
          ? { core: 'services', focus: focusOrCommand }
          : { ...focusOrCommand, core: 'services' },
      );
    },
    getDemandChunk(chunk: ChunkCoordinate): DemandChunkSnapshot | undefined {
      if (!Number.isSafeInteger(chunk.x) || !Number.isSafeInteger(chunk.y)) return undefined;
      if (!spatial.isActive(chunk)) return undefined;
      const state = demandChunks.get(chunkKey(chunk));
      if (state === undefined || state.dirty || state.values === undefined) {
        throw new Error(`Demand chunk ${chunkKey(chunk)} was not refreshed before query.`);
      }
      return copyDemandChunk(state);
    },
    queryDemandRegion(regionQuery: DemandRegionQuery): DemandRegionSnapshot {
      if (
        !Number.isSafeInteger(regionQuery.x) ||
        !Number.isSafeInteger(regionQuery.y) ||
        !Number.isSafeInteger(regionQuery.width) ||
        !Number.isSafeInteger(regionQuery.height) ||
        regionQuery.width < 1 ||
        regionQuery.height < 1
      ) {
        throw new Error('Demand region queries require a safe integer origin and positive size.');
      }
      const cellCount = regionQuery.width * regionQuery.height;
      if (cellCount > demandQueryMaxCells) {
        throw new Error(
          `Demand region query exceeds the ${String(demandQueryMaxCells)} cell limit.`,
        );
      }
      const cells: DemandCell[] = [];
      let inactiveCellCount = 0;
      for (let y = regionQuery.y; y < regionQuery.y + regionQuery.height; y += 1) {
        for (let x = regionQuery.x; x < regionQuery.x + regionQuery.width; x += 1) {
          const position = { x, y };
          const chunk = chunkCoordinateForPosition(position, chunkSize);
          if (!spatial.isActive(chunk)) {
            inactiveCellCount += 1;
            continue;
          }
          const state = demandChunks.get(chunkKey(chunk));
          if (state === undefined || state.dirty || state.values === undefined) {
            throw new Error(`Demand chunk ${chunkKey(chunk)} was not refreshed before query.`);
          }
          const local = {
            x: x - chunk.x * chunkSize,
            y: y - chunk.y * chunkSize,
          };
          cells.push(cellFromState(state, local.y * chunkSize + local.x));
        }
      }
      return {
        rect: { ...regionQuery },
        cells,
        inactiveCellCount,
      };
    },
    getSnapshot: snapshot,
    getDeterminismHash(): string {
      return stableHash(snapshot());
    },
  };
  Object.defineProperties(api, {
    getCoreState: {
      value: () => {
        const state = coreState();
        return {
          servicesCore: {
            ...state.servicesCore,
            requirements: state.servicesCore.requirements.map((requirement) => ({
              ...requirement,
            })),
            missingRequirements: [...state.servicesCore.missingRequirements],
          },
        };
      },
      enumerable: false,
    },
    getServicesCoreState: {
      value: () => {
        const state = servicesCoreState();
        return {
          ...state,
          requirements: state.requirements.map((requirement) => ({ ...requirement })),
          missingRequirements: [...state.missingRequirements],
        };
      },
      enumerable: false,
    },
    getCorePurchaseInfo: {
      value: (core?: CoreProtocol) => corePurchaseInfo(core),
      enumerable: false,
    },
    previewCorePurchase: {
      value: (command: PurchaseCoreCommand) => {
        const requestedCore: unknown = (command as { readonly core?: unknown }).core;
        if (requestedCore !== undefined && requestedCore !== 'services') {
          return { ...corePurchaseInfo(), reason: 'invalid-focus' as const };
        }
        const info = corePurchaseInfo();
        if (!isResearchFocus(command.focus)) return { ...info, reason: 'invalid-focus' as const };
        if (servicesCorePurchased) return { ...info, reason: 'already-purchased' as const };
        if (info.missingRequirements.length > 0) {
          return { ...info, reason: 'missing-prerequisites' as const };
        }
        if (data < SERVICES_CORE_COST) {
          return { ...info, reason: 'insufficient-data' as const };
        }
        return { ...info };
      },
      enumerable: false,
    },
    purchaseCore: {
      value: (command: PurchaseCoreCommand) => purchaseCore(command),
      enumerable: false,
    },
    purchaseServicesCore: {
      value: (focusOrCommand: ResearchFocus | PurchaseCoreCommand) =>
        purchaseCore(
          typeof focusOrCommand === 'string'
            ? { core: 'services', focus: focusOrCommand }
            : { ...focusOrCommand, core: 'services' },
        ),
      enumerable: false,
    },
  });
  return api;
}
