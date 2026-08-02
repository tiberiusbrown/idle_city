import {
  positionsEqual,
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
import { getDistrictSeedCost, isDistrictSeedKindUnlocked } from './balance-rules';
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
  getDistrictSeedDefinitions,
} from './district-seeds';
import {
  buildingFootprint,
  circulationEnvelope,
  circulationEnvelopeCells,
  footprintCells,
  isExteriorEntrance,
  isInsideFootprint,
  selectProjectStagingCells,
  stagingCapableEnvelopeCells,
} from './footprints';
import { findGridPathDetailed } from './pathfinding';
import { findNearestCompatiblePair } from './population';
import { SeededRandom } from './random';
import { enumerateAdjacentCorridorPairs, findTwoCellConnector } from './right-of-way';
import { createTrafficTelemetry, DEFAULT_TRAFFIC_HISTORY_WINDOW_TICKS } from './traffic';
import {
  buildMovementProposals,
  findDirectMovementSwapPairs,
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
  PlaceDistrictSeedCommand,
  Simulation,
  SimulationConfig,
  SimulationSnapshot,
  SimulationStructuralCounters,
} from './types';

interface CitizenState {
  readonly id: string;
  position: GridPosition;
  previousPosition: GridPosition;
  readonly homeBuildingId: string;
  readonly workplaceBuildingId: string;
  activity: CitizenActivity;
  activityTicksRemaining: number;
  departurePending: boolean;
  route: GridPosition[];
  routeIndex: number;
  tripStartedTick: number | null;
  waitTicks: number;
  constructionProjectId: string | null;
  constructionStagingCell: GridPosition | null;
  resumeDestinationBuildingId: string | null;
  resumeActivity: 'commuting-to-work' | 'commuting-home' | null;
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
  readonly startedTick: number;
  readonly score: number;
  readonly primaryReason: ConstructionProject['primaryReason'];
  readonly seedInfluence: number;
  readonly spatialFactor: number;
  readonly expectedAccessImprovement: number;
  readonly envelope: Building['footprint'];
  readonly connector: GridPosition[];
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
  totalCorridorExpansions: number;
  anchorChecksThisTick: number;
  finalistsValidatedThisTick: number;
  corridorExpansionsThisTick: number;
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
  citizenCount: 10,
  activityDurationTicks: 3,
  populationCap: 100,
  populationGrowthCadenceTicks: 20,
  startingData: 0,
  developmentEvaluationIntervalTicks: 20,
  developmentMinimumScore: 0.2,
  developmentCandidateSnapshotLimit: 64,
  developmentHomeCapacity: 4,
  developmentWorkplaceCapacity: 6,
  trafficHistoryWindowTicks: DEFAULT_TRAFFIC_HISTORY_WINDOW_TICKS,
  developmentAnchorCheckBudget: 512,
  developmentPreliminaryCandidateLimit: 32,
  developmentFinalistValidationBudget: 4,
  developmentCorridorExpansionBudget: 2_048,
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

function manhattanDistance(left: GridPosition, right: GridPosition): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
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
  return dx + dy;
}

function normalizedDistance(distance: number, maximum: number): number {
  return clampUnit(1 - distance / Math.max(1, maximum));
}

function rectsOverlap(left: Building['footprint'], right: Building['footprint']): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
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

function legacyScenarioPosition(
  config: SimulationConfig,
  homePosition: GridPosition,
  fallback: GridPosition,
): GridPosition {
  if (config.workplacePosition !== undefined) return copyPosition(config.workplacePosition);
  if (config.width === undefined && config.height === undefined) {
    return copyPosition(fallback);
  }
  const scenarioWidth = positiveInteger('width', config.width ?? 32, 5);
  const scenarioHeight = positiveInteger('height', config.height ?? 32, 5);
  return {
    x: Math.max(homePosition.x + 8, scenarioWidth - 6),
    y: Math.max(homePosition.y + 8, scenarioHeight - 6),
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
  const defaultHomeOrigin = {
    x: initialMinX + 1,
    y: initialMinY + 1,
  };
  const homeOrigin = copyPosition(config.homePosition ?? defaultHomeOrigin);
  const defaultWorkplaceOrigin = {
    x: initialMinX + Math.max(2, chunkSize - 7),
    y: initialMinY + Math.max(2, chunkSize - 7),
  };
  let workplaceOrigin = legacyScenarioPosition(config, homeOrigin, defaultWorkplaceOrigin);
  const homeStarterFootprint = buildingFootprint(homeOrigin, 'home');
  const homeStarterEnvelope = circulationEnvelope(homeStarterFootprint);
  const requestedWorkplaceFootprint = buildingFootprint(workplaceOrigin, 'workplace');
  const requestedWorkplaceEnvelope = circulationEnvelope(requestedWorkplaceFootprint);
  if (
    rectsOverlap(requestedWorkplaceFootprint, homeStarterEnvelope) ||
    rectsOverlap(requestedWorkplaceEnvelope, homeStarterFootprint) ||
    rectsOverlap(requestedWorkplaceEnvelope, homeStarterEnvelope)
  ) {
    const minX = initialMinX - chunkSize;
    const minY = initialMinY - chunkSize;
    const maxX = initialMinX + region.width * chunkSize + chunkSize;
    const maxY = initialMinY + region.height * chunkSize + chunkSize;
    const candidates: GridPosition[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) candidates.push({ x, y });
    }
    candidates.sort(
      (left, right) =>
        manhattanDistance(left, workplaceOrigin) - manhattanDistance(right, workplaceOrigin) ||
        comparePositions(left, right),
    );
    const replacement = candidates.find((candidate) => {
      const footprint = buildingFootprint(candidate, 'workplace');
      const envelope = circulationEnvelope(footprint);
      return (
        !rectsOverlap(footprint, homeStarterEnvelope) &&
        !rectsOverlap(envelope, homeStarterFootprint) &&
        !rectsOverlap(envelope, homeStarterEnvelope)
      );
    });
    if (replacement !== undefined) workplaceOrigin = replacement;
  }
  const initialChunkMap = new Map(
    enumerateChunkRegion(region).map((chunk) => [chunkKey(chunk), chunk]),
  );
  // Starter circulation is bootstrapped as part of initial world creation. It
  // is not an expansion policy: later chunk activation remains explicit.
  for (const origin of [homeOrigin, workplaceOrigin]) {
    const footprint = buildingFootprint(origin, origin === homeOrigin ? 'home' : 'workplace');
    for (const cell of [...footprintCells(footprint), ...circulationEnvelopeCells(footprint)]) {
      const chunk = chunkCoordinateForPosition(cell, chunkSize);
      initialChunkMap.set(chunkKey(chunk), chunk);
    }
  }
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
  const housingCapacity = nonNegativeInteger(
    'housingCapacity',
    config.housingCapacity ?? requestedCitizenCount,
  );
  const workplaceCapacity = nonNegativeInteger(
    'workplaceCapacity',
    config.workplaceCapacity ?? requestedCitizenCount,
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
  const developmentHomeCapacity = positiveInteger(
    'developmentHomeCapacity',
    config.developmentHomeCapacity ?? defaults.developmentHomeCapacity,
  );
  const developmentWorkplaceCapacity = positiveInteger(
    'developmentWorkplaceCapacity',
    config.developmentWorkplaceCapacity ?? defaults.developmentWorkplaceCapacity,
  );
  const developmentCorridorExpansionBudget = Math.min(
    defaults.developmentCorridorExpansionBudget,
    positiveInteger(
      'developmentCorridorExpansionBudget',
      config.developmentCorridorExpansionBudget ?? defaults.developmentCorridorExpansionBudget,
    ),
  );
  const constructionPhaseDurations = validateConstructionPhaseDurations(
    config.constructionPhaseDurations,
  );
  const random = new SeededRandom(seed);
  const traffic = createTrafficTelemetry({ historyWindowTicks: trafficHistoryWindowTicks });

  const starterFootprintCells = new Set<string>();
  const starterEnvelopeCells = new Set<string>();
  const starterEnvelopeStaging = new Map<string, GridPosition[]>();

  const ensureFootprintActiveAndFree = (footprint: Building['footprint']): void => {
    for (const cell of footprintCells(footprint)) {
      if (!spatial.isPositionActive(cell)) {
        throw new Error(
          `Building footprint cell ${String(cell.x)},${String(cell.y)} is in an inactive chunk.`,
        );
      }
      if (!spatial.isBuildable(cell) || starterEnvelopeCells.has(coordinateKey(cell))) {
        throw new Error(`Building footprint cell ${String(cell.x)},${String(cell.y)} is occupied.`);
      }
    }
  };

  const ensureEnvelopeActiveAndFree = (footprint: Building['footprint']): GridPosition[] => {
    const envelope = circulationEnvelope(footprint);
    const cells = circulationEnvelopeCells(footprint);
    for (const cell of cells) {
      if (!spatial.isPositionActive(cell)) {
        throw new Error(
          `Building envelope cell ${String(cell.x)},${String(cell.y)} is in an inactive chunk.`,
        );
      }
      if (
        starterFootprintCells.has(coordinateKey(cell)) ||
        starterEnvelopeCells.has(coordinateKey(cell))
      ) {
        throw new Error(
          `Building envelope ${String(envelope.x)},${String(envelope.y)} overlaps starter circulation.`,
        );
      }
    }
    const staging = stagingCapableEnvelopeCells(footprint, {
      isActive: (position) => spatial.isPositionActive(position),
      isWalkable: (position) => spatial.isWalkable(position),
      isRightOfWay: (position) => spatial.isRightOfWay(position),
    });
    if (staging.length < 3) {
      throw new Error(
        `Building envelope ${String(footprint.x)},${String(footprint.y)} has fewer than three staging cells.`,
      );
    }
    return staging;
  };

  const createBuilding = (
    id: string,
    type: Building['type'],
    origin: GridPosition,
    capacity: number,
  ): Building => {
    const footprint = buildingFootprint(origin, type);
    ensureFootprintActiveAndFree(footprint);
    const staging = ensureEnvelopeActiveAndFree(footprint);
    const entrance = staging.find((cell) => isExteriorEntrance(cell, footprint));
    if (entrance === undefined) throw new Error(`Building ${id} has no staging entrance.`);
    spatial.blockMany(footprintCells(footprint));
    for (const cell of footprintCells(footprint)) starterFootprintCells.add(coordinateKey(cell));
    for (const cell of circulationEnvelopeCells(footprint))
      starterEnvelopeCells.add(coordinateKey(cell));
    starterEnvelopeStaging.set(id, staging.map(copyPosition));
    return {
      id,
      type,
      footprint,
      entrance,
      capacity,
    };
  };

  const homeBuilding = createBuilding('home-1', 'home', homeOrigin, housingCapacity);
  const workplaceBuilding = createBuilding(
    'workplace-1',
    'workplace',
    workplaceOrigin,
    workplaceCapacity,
  );
  const starterConnector = findTwoCellConnector({
    startPairs: enumerateAdjacentCorridorPairs(starterEnvelopeStaging.get(homeBuilding.id) ?? []),
    goalPairs: enumerateAdjacentCorridorPairs(
      starterEnvelopeStaging.get(workplaceBuilding.id) ?? [],
    ),
    isActive: (position) => spatial.isPositionActive(position),
    isCellAvailable: (position) => spatial.isWalkable(position) || spatial.isRightOfWay(position),
    maxExpansions: Math.max(developmentCorridorExpansionBudget, pathSearchBudget),
  });
  if (starterConnector.status !== 'found') {
    throw new Error(`Starter circulation connector failed: ${starterConnector.status}.`);
  }
  spatial.markRightOfWayMany(starterConnector.cells);
  const buildings: Building[] = [homeBuilding, workplaceBuilding];
  const buildingsById = new Map(buildings.map((building) => [building.id, building]));
  const initialPopulation = Math.min(
    requestedCitizenCount,
    populationCap,
    homeBuilding.capacity,
    workplaceBuilding.capacity,
  );
  const createCitizenState = (id: string, home: Building, workplace: Building): CitizenState => ({
    id,
    position: copyPosition(home.entrance),
    previousPosition: copyPosition(home.entrance),
    homeBuildingId: home.id,
    workplaceBuildingId: workplace.id,
    activity: 'home',
    activityTicksRemaining: 1 + random.nextInteger(activityDurationTicks),
    departurePending: false,
    route: [],
    routeIndex: 0,
    tripStartedTick: null,
    waitTicks: 0,
    constructionProjectId: null,
    constructionStagingCell: null,
    resumeDestinationBuildingId: null,
    resumeActivity: null,
  });
  const citizens: CitizenState[] = Array.from({ length: initialPopulation }, (_, index) =>
    createCitizenState(`citizen-${String(index + 1)}`, homeBuilding, workplaceBuilding),
  );
  const citizensById = new Map(citizens.map((citizen) => [citizen.id, citizen]));
  let nextCitizenSequence = initialPopulation + 1;

  let tick = 0;
  let completedTrips = 0;
  let completedActivities = 0;
  let totalTripDurationTicks = 0;
  let data = startingData;
  let dataGeneratedThisTick = 0;
  const seeds: DistrictSeed[] = [];
  const constructionProjects: ConstructionProjectState[] = [];
  const circulationCells = new Set<string>();
  for (const building of buildings) {
    for (const cell of circulationEnvelopeCells(building.footprint)) {
      circulationCells.add(coordinateKey(cell));
    }
  }
  const isCirculationWalkable = (position: GridPosition): boolean =>
    spatial.isWalkable(position) &&
    (spatial.isRightOfWay(position) || circulationCells.has(coordinateKey(position)));
  let nextConstructionProjectId = 1;
  const nextBuildingSequence: Record<BuildingType, number> = {
    home: 2,
    workplace: 2,
  };
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
    corridorExpansionsThisTick: 0,
    totalAnchorChecks: 0,
    totalFinalistsValidated: 0,
    totalCorridorExpansions: 0,
  };
  let developmentJobsStarted = 0;
  let developmentJobsSuperseded = 0;
  let developmentJobsCompleted = 0;
  let developmentAnchorChecks = 0;
  let developmentPreliminaryCandidatesRetained = 0;
  let developmentFinalistValidations = 0;
  let developmentCorridorStateExpansions = 0;
  let developmentNoConnectorRejections = 0;
  let developmentAffectedRouteReplans = 0;
  const developmentRoutePreservationChecks = 0;
  let developmentPeakAnchorChecksPerTick = 0;
  let developmentPeakFinalistValidationsPerTick = 0;
  let developmentPeakCorridorExpansionsPerTick = 0;
  let rightOfWayCellsAdded = spatial.getRightOfWayCellCount();
  let rightOfWayRevisionChanges = spatial
    .getActiveChunks()
    .reduce((total, chunk) => total + spatial.getRightOfWayRevision(chunk), 0);
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
  let movementDeadlockRecoveries = 0;
  let constructionAssignmentsOffered = 0;
  let constructionAssignmentsAccepted = 0;
  let constructionCommutes = 0;
  let constructionWorkerArrivals = 0;
  let constructionLaborUnits = 0;
  let constructionPausedProjectTicks = 0;
  let constructionPhaseCompletions = 0;
  let constructionWorkerReleases = 0;
  const deadlockPairStates = new Map<string, DeadlockPairState>();
  const demandChunks = new Map<string, DemandChunkState>();
  const demandCitizens = (): readonly {
    readonly homeBuildingId: string;
    readonly workplaceBuildingId: string;
  }[] =>
    citizens.map(({ homeBuildingId, workplaceBuildingId }) => ({
      homeBuildingId,
      workplaceBuildingId,
    }));

  const isDistrictSeedKind = (value: unknown): value is DistrictSeedKind =>
    value === 'living' || value === 'working' || value === 'services';

  const activeSameTypeSeedCount = (kind: DistrictSeedKind): number =>
    seeds.reduce((count, seed) => count + (seed.kind === kind ? 1 : 0), 0);

  const currentDistrictSeedCost = (kind: DistrictSeedKind): number =>
    getDistrictSeedCost(kind, activeSameTypeSeedCount(kind));

  const validateDistrictSeedPlacement = (
    command: PlaceDistrictSeedCommand,
  ): DistrictSeedPlacementValidation => {
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
        reason: spatial.isRightOfWay(requestedPosition) ? 'right-of-way' : 'occupied',
      };
    }
    if (seeds.some((districtSeed) => positionsEqual(districtSeed.position, requestedPosition))) {
      return { accepted: false, reason: 'occupied' };
    }
    const requestedKind: unknown = command.kind;
    if (!isDistrictSeedKind(requestedKind)) {
      return { accepted: false, reason: 'invalid-kind' };
    }
    if (!isDistrictSeedKindUnlocked(requestedKind)) {
      return { accepted: false, reason: 'locked' };
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
      cost: isDistrictSeedKind(requestedKind) ? currentDistrictSeedCost(requestedKind) : 0,
      coveredCellCount: coveredCells.length,
      activeCoveredCellCount: activeCoveredCells.length,
      coveredCells: coveredCells.map(copyPosition),
      activeCoveredCells: activeCoveredCells.map(copyPosition),
      valid: validation.accepted,
      ...(validation.accepted ? {} : { reason: validation.reason }),
    };
  };

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
    const plannedTripDistances = citizens.map((citizen) =>
      manhattanDistance(
        buildingById(citizen.homeBuildingId).entrance,
        buildingById(citizen.workplaceBuildingId).entrance,
      ),
    );
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
    if (!positionsEqual(citizen.position, destination.entrance)) {
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
    clearDeadlockPairsForCitizen(citizen.id);
    completedTrips += 1;
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
    constructionWorkerArrivals += 1;
  };

  const startTrip = (
    citizen: CitizenState,
    activity: CitizenActivity,
    destinationId: string,
  ): boolean => {
    const destination = buildingById(destinationId);
    const result = findGridPathDetailed(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        isWalkable: (position) => isCirculationWalkable(position),
        maxNodes: pathSearchBudget,
      },
      citizen.position,
      destination.entrance,
    );
    pathNodesExpanded += result.nodesExpanded;
    pathChunksTouched += result.chunksTouched;
    if (result.status !== 'found') {
      throw new Error(
        `Citizen ${citizen.id} could not route to ${destination.id}: ${result.status}.`,
      );
    }
    citizen.activity = activity;
    citizen.departurePending = false;
    citizen.route = result.path.map(copyPosition);
    citizen.routeIndex = 0;
    citizen.tripStartedTick = tick;
    citizen.waitTicks = 0;
    clearDeadlockPairsForCitizen(citizen.id);
    if (citizen.route.length === 1) {
      completeTrip(citizen, destinationId);
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
    return buildingType === 'home' ? cell.living : cell.working;
  };

  const matchingSeedInfluenceAt = (position: GridPosition, buildingType: BuildingType): number =>
    calculateDistrictSeedInfluence({
      seeds,
      position,
      kind: buildingType === 'home' ? 'living' : 'working',
    });

  const occupancyByBuilding = (): Map<string, number> => {
    const occupancy = new Map<string, number>();
    for (const citizen of citizens) {
      occupancy.set(citizen.homeBuildingId, (occupancy.get(citizen.homeBuildingId) ?? 0) + 1);
      occupancy.set(
        citizen.workplaceBuildingId,
        (occupancy.get(citizen.workplaceBuildingId) ?? 0) + 1,
      );
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
          !spatial.isRightOfWay(stagingCell) ||
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
      'home',
      'commuting-to-work',
      'work',
      'commuting-home',
      'commuting-to-construction',
      'constructing',
    ];
    const movingCells = new Map<string, string>();
    for (const citizen of citizens) {
      if (citizenIds.has(citizen.id)) throw new Error(`Duplicate citizen id ${citizen.id}.`);
      citizenIds.add(citizen.id);
      const home = buildingById(citizen.homeBuildingId);
      const workplace = buildingById(citizen.workplaceBuildingId);
      if (home.type !== 'home') throw new Error(`Citizen ${citizen.id} has an invalid home.`);
      if (workplace.type !== 'workplace') {
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
      const constructionProject =
        citizen.constructionProjectId === null
          ? undefined
          : constructionProjects.find((project) => project.id === citizen.constructionProjectId);
      if (citizen.constructionProjectId !== null && constructionProject === undefined) {
        throw new Error(`Citizen ${citizen.id} references missing construction project.`);
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
        if (citizen.resumeDestinationBuildingId === null || citizen.resumeActivity === null) {
          throw new Error(`Citizen ${citizen.id} has no saved construction resume destination.`);
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
          citizen.activity === 'commuting-to-construction') &&
        citizen.route.length === 0
      ) {
        throw new Error(`Commuter ${citizen.id} has an empty route.`);
      }
      if (
        citizen.activity === 'commuting-to-work' ||
        citizen.activity === 'commuting-home' ||
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
      if (!spatial.isPositionActive(citizen.position) || !isCirculationWalkable(citizen.position)) {
        throw new Error(`Citizen ${citizen.id} is outside active walkable space.`);
      }
      if (blockedCells.has(coordinateKey(citizen.position))) {
        throw new Error(`Citizen ${citizen.id} occupies a blocked interior.`);
      }
      if (
        !spatial.isPositionActive(citizen.previousPosition) ||
        !isCirculationWalkable(citizen.previousPosition) ||
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
        if (!spatial.isPositionActive(position) || !isCirculationWalkable(position)) {
          throw new Error(`Citizen ${citizen.id} route leaves walkable space.`);
        }
        if (blockedCells.has(coordinateKey(position))) {
          throw new Error(`Citizen ${citizen.id} route enters a blocked interior.`);
        }
        const previous = citizen.route[index - 1];
        if (previous !== undefined && manhattanDistance(previous, position) !== 1) {
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
    const opposite = buildingType === 'home' ? 'workplace' : 'home';
    let factor = 0;
    for (const building of buildings) {
      if (building.type !== opposite) continue;
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
    const opposite = buildingType === 'home' ? 'workplace' : 'home';
    let factor = 0;
    for (const building of buildings) {
      if (building.type !== opposite) continue;
      factor = Math.max(
        factor,
        normalizedDistance(manhattanDistance(entrance, building.entrance), demandInfluenceRadius),
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
    if (!isCirculationWalkable(start) || !isCirculationWalkable(goal)) return false;
    const result = findGridPathDetailed(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        isWalkable: (position) =>
          isCirculationWalkable(position) && !blocked.has(coordinateKey(position)),
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

  type CandidateValidation =
    | {
        readonly status: 'valid';
        readonly connector: readonly GridPosition[];
        readonly expansions: number;
      }
    | { readonly status: 'no-connector'; readonly expansions: number }
    | { readonly status: 'budget-exhausted'; readonly expansions: number };

  const existingProjectFootprints = (): readonly Building['footprint'][] => [
    ...buildings.map((building) => building.footprint),
    ...constructionProjects.map((project) => project.footprint),
  ];

  const existingBuildingCirculationCells = (): ReadonlySet<string> => new Set(circulationCells);

  const movingExclusiveCells = (): ReadonlySet<string> => {
    const cells = new Set<string>();
    for (const citizen of citizens) {
      if (citizen.activity !== 'commuting-to-work' && citizen.activity !== 'commuting-home')
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
    const activeChunks = spatial.getActiveChunks().sort(compareChunks);
    if (capacityPressure) return activeChunks;
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
        return dx + dy <= radius;
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
    const footprint = buildingFootprint(anchor, buildingType);
    const envelope = circulationEnvelope(footprint);
    const reservedCirculation = existingBuildingCirculationCells();
    const protectedFootprints = existingProjectFootprints();
    const protectedPositions = movingExclusiveCells();
    const footprintCellsForCandidate = footprintCells(footprint);
    if (
      !isRectInsideActiveSpace(footprint) ||
      footprintCellsForCandidate.some(
        (cell) =>
          !spatial.isBuildable(cell) ||
          reservedCirculation.has(coordinateKey(cell)) ||
          protectedPositions.has(coordinateKey(cell)) ||
          protectedFootprints.some((protectedFootprint) =>
            isInsideFootprint(cell, protectedFootprint),
          ),
      )
    ) {
      developmentFootprintsRejected += 1;
      return undefined;
    }
    const envelopeCellsForCandidate = circulationEnvelopeCells(footprint);
    if (
      envelopeCellsForCandidate.some(
        (cell) =>
          !spatial.isPositionActive(cell) ||
          protectedFootprints.some((protectedFootprint) =>
            isInsideFootprint(cell, protectedFootprint),
          ) ||
          reservedCirculation.has(coordinateKey(cell)) ||
          protectedPositions.has(coordinateKey(cell)),
      )
    ) {
      developmentFootprintsRejected += 1;
      return undefined;
    }
    const stagingCandidates = stagingCapableEnvelopeCells(footprint, {
      isActive: (position) => spatial.isPositionActive(position),
      isWalkable: (position) => spatial.isWalkable(position),
      isRightOfWay: (position) => spatial.isRightOfWay(position),
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
      isRightOfWay: (position) => spatial.isRightOfWay(position),
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
    let nearestRowDistance = Number.POSITIVE_INFINITY;
    for (const cell of footprintCellsForCandidate) {
      for (const building of buildings) {
        nearestRowDistance = Math.min(
          nearestRowDistance,
          manhattanDistance(cell, building.entrance),
        );
      }
    }
    const entranceAccessibility =
      nearestRowDistance === Number.POSITIVE_INFINITY
        ? 0
        : normalizedDistance(nearestRowDistance, Math.max(1, demandInfluenceRadius * 2));
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
      envelope: { ...envelope },
      stagingCells: staging.map(copyPosition),
    };
  };

  const validateCandidateConnector = (
    candidate: DevelopmentCandidate,
    maxExpansions: number,
  ): CandidateValidation => {
    if (maxExpansions < 1) return { status: 'budget-exhausted', expansions: 0 };
    const candidateFootprint = new Set(footprintCells(candidate.footprint).map(coordinateKey));
    const movingCells = movingExclusiveCells();
    const sourceStaging: GridPosition[] = [];
    for (const building of buildings) {
      sourceStaging.push(
        ...stagingCapableEnvelopeCells(building.footprint, {
          isActive: (position) => spatial.isPositionActive(position),
          isWalkable: (position) => spatial.isWalkable(position),
          isRightOfWay: (position) => spatial.isRightOfWay(position),
        }),
      );
    }
    const targetStaging = candidate.stagingCells?.map(copyPosition) ?? [];
    const result = findTwoCellConnector({
      startPairs: enumerateAdjacentCorridorPairs(sourceStaging),
      goalPairs: enumerateAdjacentCorridorPairs(targetStaging),
      isActive: (position) => spatial.isPositionActive(position),
      isCellAvailable: (position) =>
        !candidateFootprint.has(coordinateKey(position)) &&
        !movingCells.has(coordinateKey(position)) &&
        spatial.isWalkable(position),
      maxExpansions,
    });
    developmentCorridorStateExpansions += result.expansions;
    if (result.status === 'budget-exhausted') {
      return { status: 'budget-exhausted', expansions: result.expansions };
    }
    if (result.status !== 'found') return { status: 'no-connector', expansions: result.expansions };
    return {
      status: 'valid',
      connector: result.cells.map(copyPosition),
      expansions: result.expansions,
    };
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
      if (!replanCitizen(citizen, movingOccupancy)) {
        throw new Error(
          `Affected route for ${citizen.id} could not replan after project placement.`,
        );
      }
      developmentAffectedRouteReplans += 1;
    }
  };

  const capacityForDevelopment = (buildingType: BuildingType): number =>
    buildingType === 'home' ? developmentHomeCapacity : developmentWorkplaceCapacity;

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
      stagingCapableEnvelopeCells(candidate.footprint, {
        isActive: (position) => spatial.isPositionActive(position),
        isWalkable: (position) => spatial.isWalkable(position),
        isRightOfWay: (position) => spatial.isRightOfWay(position),
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

  const startConstruction = (
    candidate: DevelopmentCandidate,
    connector: readonly GridPosition[],
  ): boolean => {
    const stagingCells = selectConstructionStaging(candidate);
    if (stagingCells === undefined) {
      developmentEntrancesRejected += 1;
      return false;
    }
    const footprint = footprintCells(candidate.footprint);
    const rowCells = [...connector, ...stagingCells];
    for (const cell of rowCells) {
      if (!spatial.isPositionActive(cell) || !spatial.isWalkable(cell)) return false;
      if (isInsideFootprint(cell, candidate.footprint)) return false;
    }
    spatial.blockMany(footprint);
    const newRightOfWayCells = rowCells.filter((cell) => !spatial.isRightOfWay(cell));
    spatial.markRightOfWayMany(rowCells);
    rightOfWayCellsAdded += newRightOfWayCells.length;
    rightOfWayRevisionChanges += newRightOfWayCells.length;
    for (const cell of circulationEnvelopeCells(candidate.footprint)) {
      circulationCells.add(coordinateKey(cell));
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
      startedTick: tick,
      score: candidate.score,
      primaryReason: { ...candidate.primaryReason },
      seedInfluence: candidate.seedInfluence,
      spatialFactor: candidate.spatialFactor,
      expectedAccessImprovement: candidate.expectedAccessImprovement,
      envelope: circulationEnvelope(candidate.footprint),
      connector: connector.map(copyPosition),
      stagingCells: stagingCells.map(copyPosition),
    };
    constructionProjects.push(project);
    nextConstructionProjectId += 1;
    constructionProjectsStarted += 1;
    developmentStateVersion += 1;
    replanAffectedRoutes(project.footprint);
    return true;
  };

  const completeConstructionProject = (project: ConstructionProjectState): void => {
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
      capacity: project.capacity,
    };
    if (buildingsById.has(building.id))
      throw new Error(`Duplicate constructed building ${building.id}.`);
    buildings.push(building);
    buildingsById.set(building.id, building);
    for (const cell of circulationEnvelopeCells(building.footprint)) {
      circulationCells.add(coordinateKey(cell));
    }
    nextBuildingSequence[project.buildingType] = sequence + 1;
    constructionProjectsCompleted += 1;
    developmentStateVersion += 1;
    markAllDemandChunksDirty();
  };

  const constructionWorkers = (projectId: string): CitizenState[] =>
    sortedCitizens().filter((citizen) => citizen.constructionProjectId === projectId);

  const releaseConstructionWorker = (citizen: CitizenState): void => {
    const destinationId = citizen.resumeDestinationBuildingId;
    const resumeActivity = citizen.resumeActivity;
    if (destinationId === null || resumeActivity === null) {
      throw new Error(`Construction worker ${citizen.id} has no saved resume destination.`);
    }
    citizen.constructionProjectId = null;
    citizen.constructionStagingCell = null;
    citizen.resumeDestinationBuildingId = null;
    citizen.resumeActivity = null;
    citizen.route = [];
    citizen.routeIndex = 0;
    citizen.waitTicks = 0;
    citizen.tripStartedTick = null;
    constructionWorkerReleases += 1;
    startTrip(citizen, resumeActivity, destinationId);
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
      project.paused = constructingWorkers.length === 0;
      if (project.paused) constructionPausedProjectTicks += 1;

      const remainingLabor = project.phaseLaborRequired - project.phaseLaborCompleted;
      const labor = Math.min(remainingLabor, constructingWorkers.length);
      if (labor > 0) {
        project.phaseLaborCompleted += labor;
        constructionLaborUnits += labor;
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
      const nextPhase = nextConstructionPhase(project.phase);
      if (nextPhase === undefined) {
        for (const worker of constructionWorkers(project.id)) releaseConstructionWorker(worker);
        completeConstructionProject(project);
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
      corridorExpansionsThisTick: job.corridorExpansionsThisTick,
      totalAnchorChecks: job.totalAnchorChecks,
      totalFinalistsValidated: job.totalFinalistsValidated,
      totalCorridorExpansions: job.totalCorridorExpansions,
    };
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
        corridorExpansionsThisTick: developmentJob.corridorExpansionsThisTick,
        totalAnchorChecks: developmentJob.totalAnchorChecks,
        totalFinalistsValidated: developmentJob.totalFinalistsValidated,
        totalCorridorExpansions: developmentJob.totalCorridorExpansions,
      };
    }
    developmentJob = undefined;
  };

  const startDevelopmentJob = (): void => {
    if (constructionProjects.length > 0) return;
    if (seeds.length === 0 && calculateMetrics().metrics.space >= 1) {
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
      totalCorridorExpansions: 0,
      anchorChecksThisTick: 0,
      finalistsValidatedThisTick: 0,
      corridorExpansionsThisTick: 0,
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
    job.corridorExpansionsThisTick = 0;
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
            ...(candidate.envelope === undefined ? {} : { envelope: { ...candidate.envelope } }),
            ...(candidate.stagingCells === undefined
              ? {}
              : { stagingCells: candidate.stagingCells.map(copyPosition) }),
          }));
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
      job.finalistsValidatedThisTick < defaults.developmentFinalistValidationBudget &&
      job.corridorExpansionsThisTick < developmentCorridorExpansionBudget
    ) {
      const candidate = job.preliminary[job.finalistIndex];
      if (candidate === undefined) {
        finishDevelopmentJob('complete');
        break;
      }
      const remainingExpansions =
        developmentCorridorExpansionBudget - job.corridorExpansionsThisTick;
      const validation = validateCandidateConnector(candidate, remainingExpansions);
      job.corridorExpansionsThisTick += validation.expansions;
      job.totalCorridorExpansions += validation.expansions;
      if (validation.status === 'budget-exhausted') {
        developmentFinalistValidations += 1;
        job.finalistsValidatedThisTick += 1;
        job.totalFinalistsValidated += 1;
        break;
      }
      job.finalistIndex += 1;
      job.finalistsValidatedThisTick += 1;
      job.totalFinalistsValidated += 1;
      developmentFinalistValidations += 1;
      if (validation.status === 'no-connector') {
        developmentNoConnectorRejections += 1;
        continue;
      }
      const before = constructionProjectsStarted;
      startConstruction(candidate, validation.connector);
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
              connector: validation.connector.map(copyPosition),
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
    developmentPeakCorridorExpansionsPerTick = Math.max(
      developmentPeakCorridorExpansionsPerTick,
      job.corridorExpansionsThisTick,
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
    const reservedStaging = reservedConstructionStagingCells();
    const goalKey = coordinateKey(stagingCell);
    const result = findGridPathDetailed(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        isWalkable: (position) =>
          isCirculationWalkable(position) &&
          (coordinateKey(position) === goalKey || !reservedStaging.has(coordinateKey(position))),
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
        (citizen.activity === 'home' || citizen.activity === 'work') &&
        citizen.departurePending &&
        citizen.activityTicksRemaining === 0,
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
      citizen.resumeDestinationBuildingId =
        citizen.activity === 'home' ? citizen.workplaceBuildingId : citizen.homeBuildingId;
      citizen.resumeActivity = citizen.activity === 'home' ? 'commuting-to-work' : 'commuting-home';
      citizen.activity = 'commuting-to-construction';
      citizen.departurePending = false;
      citizen.route = offer.route.map(copyPosition);
      citizen.routeIndex = 0;
      citizen.tripStartedTick = tick;
      citizen.waitTicks = 0;
      assignedCitizens.add(citizen.id);
      assignedStaging.add(stagingKey);
      projectCounts.set(project.id, projectWorkerCount + 1);
      movingOccupancy.set(originKey, citizen.id);
      constructionAssignmentsAccepted += 1;
    }
  };

  const advanceCitizenSchedules = (movingOccupancy: Map<string, string>): void => {
    const boundaryCitizens: CitizenState[] = [];
    for (const citizen of sortedCitizens()) {
      if (citizen.activity !== 'home' && citizen.activity !== 'work') continue;
      if (citizen.activityTicksRemaining > 0) citizen.activityTicksRemaining -= 1;
      if (citizen.activityTicksRemaining > 0) continue;
      if (!citizen.departurePending) {
        citizen.departurePending = true;
      }
      boundaryCitizens.push(citizen);
    }
    assignConstructionWorkers(movingOccupancy);
    for (const citizen of boundaryCitizens) {
      if (citizen.constructionProjectId !== null) continue;
      const originKey = coordinateKey(citizen.position);
      if (movingOccupancy.has(originKey)) continue;
      const activity: CitizenActivity =
        citizen.activity === 'home' ? 'commuting-to-work' : 'commuting-home';
      const destinationId =
        activity === 'commuting-to-work' ? citizen.workplaceBuildingId : citizen.homeBuildingId;
      if (startTrip(citizen, activity, destinationId)) {
        movingOccupancy.set(originKey, citizen.id);
      }
      if (activity === 'commuting-home') completedActivities += 1;
    }
  };

  const replanCitizen = (
    citizen: CitizenState,
    movingOccupancy: ReadonlyMap<string, string>,
  ): boolean => {
    const isConstructionCommute = citizen.activity === 'commuting-to-construction';
    const destinationId = isConstructionCommute
      ? citizen.constructionProjectId
      : citizen.activity === 'commuting-to-work'
        ? citizen.workplaceBuildingId
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
    if (isConstructionCommute) {
      for (const reserved of reservedConstructionStagingCells()) {
        if (reserved !== coordinateKey(destination)) temporaryBlocked.add(reserved);
      }
    }
    movementReplansAttempted += 1;
    const result = replanMovementRoute({
      chunkSize,
      activeChunks: spatial.getActiveChunks(),
      start: citizen.position,
      goal: destination,
      currentRoute: citizen.route,
      currentRouteIndex: citizen.routeIndex,
      temporaryBlocked,
      isWalkable: (position) => isCirculationWalkable(position),
      maxNodes: pathSearchBudget,
    });
    pathNodesExpanded += result.nodesExpanded;
    pathChunksTouched += result.chunksTouched;
    if (result.status !== 'found') return false;
    const replannedRoute = result.path.map(copyPosition);
    citizen.route = replannedRoute;
    citizen.routeIndex = result.routeIndex;
    movementReplansSucceeded += 1;
    if (result.routeChanged) clearDeadlockPairsForCitizen(citizen.id);
    return true;
  };

  const maybeReplanBlockedCitizens = (blockedIds: readonly string[]): void => {
    if (blockedIds.length === 0) return;
    const movingOccupancy = snapshotMovingOccupancy();
    const orderedIds = [...blockedIds].sort();
    for (const citizenId of orderedIds) {
      const citizen = citizensById.get(citizenId);
      if (citizen === undefined) throw new Error(`Blocked movement references ${citizenId}.`);
      if (!isMovementReplanDue(citizen.waitTicks)) continue;
      replanCitizen(citizen, movingOccupancy);
    }
  };

  const advanceCitizens = (): void => {
    const movingOccupancy = snapshotMovingOccupancy();
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
      });
    }
    const proposals = buildMovementProposals({
      candidates,
      isActive: (position) => spatial.isPositionActive(position),
      isWalkable: (position) => isCirculationWalkable(position),
    });
    movementProposals += proposals.length;
    const directSwapPairs = findDirectMovementSwapPairs(proposals);
    const emergencySwapPairs = new Set<string>();
    for (const pair of directSwapPairs) {
      const previous = deadlockPairStates.get(pair.key);
      if (
        previous !== undefined &&
        pairStateMatches(previous, pair) &&
        isMovementDeadlockRecoveryDue(previous.blockedTicks, true)
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
            : citizen.homeBuildingId;
        completeTrip(citizen, destinationId);
      }
    }

    if (resolution.accepted.length > 0) clearAllDeadlockPairs();
    else updateDeadlockPairStates(resolution.directSwapPairs, emergencySwapPairs);
    const blockedIds = resolution.blocked.map(({ citizenId }) => citizenId);
    maybeReplanBlockedCitizens(blockedIds);
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
        rightOfWayRevision: spatial.getRightOfWayRevision(chunk),
        staticTopologyRevision: spatial.getStaticTopologyRevision(chunk),
        rightOfWayBufferAllocated: spatial.hasRightOfWayBuffer(chunk),
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

  const rightOfWaySnapshot = (): SimulationSnapshot['rightOfWay'] =>
    spatial
      .getActiveChunks()
      .sort(compareChunks)
      .map((chunk) => ({
        chunk: copyChunk(chunk),
        key: chunkKey(chunk),
        revision: spatial.getRightOfWayRevision(chunk),
        cells: spatial.getRightOfWayCells(chunk).map(copyPosition),
      }))
      .filter((chunk) => chunk.cells.length > 0);

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
      movementDeadlockRecoveries,
      allocatedRightOfWayBuffers: spatial.getAllocatedRightOfWayBufferCount(),
      rightOfWayCells: spatial.getRightOfWayCellCount(),
      rightOfWayCellsAdded,
      rightOfWayRevisionChanges,
      staticTopologyRevision: spatial.getStaticTopologyRevisionTotal(),
      developmentJobsStarted,
      developmentJobsSuperseded,
      developmentJobsCompleted,
      developmentAnchorChecks,
      developmentPreliminaryCandidatesRetained,
      developmentFinalistValidations,
      developmentCorridorStateExpansions,
      developmentNoConnectorRejections,
      developmentAffectedRouteReplans,
      developmentRoutePreservationChecks,
      developmentPeakAnchorChecksPerTick,
      developmentPeakFinalistValidationsPerTick,
      developmentPeakCorridorExpansionsPerTick,
      constructionAssignmentsOffered,
      constructionAssignmentsAccepted,
      constructionCommutes,
      constructionWorkerArrivals,
      constructionLaborUnits,
      constructionPausedProjectTicks,
      constructionPhaseCompletions,
      constructionWorkerReleases,
    };
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
      data,
      dataGeneratedThisTick,
      averageTripDurationTicks,
      metrics,
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
      districtSeedDefinitions: getDistrictSeedDefinitions().map((definition) => ({
        ...definition,
      })),
      rightOfWay: rightOfWaySnapshot().map((chunk) => ({
        ...chunk,
        chunk: copyChunk(chunk.chunk),
        cells: chunk.cells.map(copyPosition),
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
        route: citizen.route.map(copyPosition),
        routeIndex: citizen.routeIndex,
        waitTicks: citizen.waitTicks,
        constructionProjectId: citizen.constructionProjectId,
        constructionStagingCell:
          citizen.constructionStagingCell === null
            ? null
            : copyPosition(citizen.constructionStagingCell),
        resumeDestinationBuildingId: citizen.resumeDestinationBuildingId,
      })),
      developmentCandidates: lastDevelopmentCandidates.map((candidate) => ({
        ...candidate,
        anchor: copyPosition(candidate.anchor),
        footprint: { ...candidate.footprint },
        entrance: copyPosition(candidate.entrance),
        primaryReason: { ...candidate.primaryReason },
        ...(candidate.envelope === undefined ? {} : { envelope: { ...candidate.envelope } }),
        ...(candidate.connector === undefined
          ? {}
          : { connector: candidate.connector.map(copyPosition) }),
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
        startedTick: project.startedTick,
        score: project.score,
        primaryReason: { ...project.primaryReason },
        seedInfluence: project.seedInfluence,
        spatialFactor: project.spatialFactor,
        expectedAccessImprovement: project.expectedAccessImprovement,
        envelope: { ...project.envelope },
        connector: project.connector.map(copyPosition),
        stagingCells: project.stagingCells.map(copyPosition),
      })),
    };
  };

  return {
    step(): void {
      const metricsBefore = calculateMetrics().metrics;
      const activitiesBefore = completedActivities;
      tick += 1;
      traffic.advanceToTick(tick);
      advanceCitizens();
      advanceConstructionProjects();
      const populationGrew = tick % populationGrowthCadenceTicks === 0 ? growPopulation() : false;
      const metricsAfter = calculateMetrics().metrics;
      if (populationGrew || !sameMetrics(metricsBefore, metricsAfter)) {
        markAllDemandChunksDirty();
        if (populationGrew) developmentStateVersion += 1;
      }
      const activitiesCompletedThisTick = completedActivities - activitiesBefore;
      dataGeneratedThisTick = 0;
      if (activitiesCompletedThisTick > 0) {
        dataGeneratedThisTick = roundData(
          activitiesCompletedThisTick * dataEfficiency(metricsAfter),
        );
        data = roundData(data + dataGeneratedThisTick);
      }
      refreshDirtyDemandChunks();
      evaluateDevelopers(tick % developmentEvaluationIntervalTicks === 0);
      assertPopulationInvariants();
    },
    getDistrictSeedDefinitions(): readonly DistrictSeedDefinition[] {
      return getDistrictSeedDefinitions().map((definition) => ({ ...definition }));
    },
    getDistrictSeedDefinition(kind: DistrictSeedKind): DistrictSeedDefinition {
      return getDistrictSeedDefinition(kind);
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
}
