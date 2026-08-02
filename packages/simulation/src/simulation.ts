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
import { nextConstructionPhase, validateConstructionPhaseDurations } from './construction';
import { calculateDemandChunk } from './demand';
import {
  compareDevelopmentCandidates,
  compareDevelopmentBuildingTypes,
  DEVELOPMENT_BUILDING_TYPE_ORDER,
  scoreDevelopmentCandidate,
} from './developer';
import { calculateDistrictSeedInfluence } from './district-seeds';
import {
  buildingFootprint,
  exteriorEntranceCandidates,
  footprintCells,
  isInsideFootprint,
  selectExteriorEntrance,
} from './footprints';
import { findGridPathDetailed } from './pathfinding';
import { findNearestCompatiblePair } from './population';
import { SeededRandom } from './random';
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
  DistrictSeed,
  DistrictSeedKind,
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
  route: GridPosition[];
  routeIndex: number;
  tripStartedTick: number | null;
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
  phaseTicksRemaining: number;
  phaseTicksElapsed: number;
  totalTicksElapsed: number;
  readonly startedTick: number;
  readonly score: number;
  readonly primaryReason: ConstructionProject['primaryReason'];
  readonly seedInfluence: number;
  readonly spatialFactor: number;
  readonly expectedAccessImprovement: number;
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

const developmentDirections: readonly GridPosition[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

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
  const region = resolveRegion(config);
  const initialChunks = enumerateChunkRegion(region);
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
  const constructionPhaseDurations = validateConstructionPhaseDurations(
    config.constructionPhaseDurations,
  );
  const random = new SeededRandom(seed);
  const initialMinX = region.minX * chunkSize;
  const initialMinY = region.minY * chunkSize;
  const defaultHomeOrigin = {
    x: initialMinX,
    y: initialMinY,
  };
  const defaultWorkplaceOrigin = {
    x: initialMinX + chunkSize - 5,
    y: initialMinY + chunkSize - 5,
  };
  const homeOrigin = copyPosition(config.homePosition ?? defaultHomeOrigin);
  const workplaceOrigin = legacyScenarioPosition(config, homeOrigin, defaultWorkplaceOrigin);

  const ensureFootprintActiveAndFree = (footprint: Building['footprint']): void => {
    for (const cell of footprintCells(footprint)) {
      if (!spatial.isPositionActive(cell)) {
        throw new Error(
          `Building footprint cell ${String(cell.x)},${String(cell.y)} is in an inactive chunk.`,
        );
      }
      if (!spatial.isWalkable(cell)) {
        throw new Error(`Building footprint cell ${String(cell.x)},${String(cell.y)} is occupied.`);
      }
    }
  };

  const createBuilding = (
    id: string,
    type: Building['type'],
    origin: GridPosition,
    capacity: number,
  ): Building => {
    const footprint = buildingFootprint(origin, type);
    ensureFootprintActiveAndFree(footprint);
    const entrance = selectExteriorEntrance(footprint, {
      isActive: (position) => spatial.isPositionActive(position),
      isWalkable: (position) => spatial.isWalkable(position),
    });
    spatial.blockMany(footprintCells(footprint));
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
    route: [],
    routeIndex: 0,
    tripStartedTick: null,
  });
  const citizens: CitizenState[] = Array.from({ length: initialPopulation }, (_, index) =>
    createCitizenState(`citizen-${String(index + 1)}`, homeBuilding, workplaceBuilding),
  );
  let nextCitizenSequence = initialPopulation + 1;

  let tick = 0;
  let completedTrips = 0;
  let completedActivities = 0;
  let totalTripDurationTicks = 0;
  let data = startingData;
  let dataGeneratedThisTick = 0;
  const seeds: DistrictSeed[] = [];
  const constructionProjects: ConstructionProjectState[] = [];
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
  let lastEvaluatedDevelopmentStateVersion = -1;
  let nextSeedId = 1;
  let demandChunksDirtied = 0;
  let demandChunksEvaluated = 0;
  let pathNodesExpanded = 0;
  let pathChunksTouched = 0;
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
    const minChunk = chunkCoordinateForPosition(
      { x: position.x - demandInfluenceRadius, y: position.y - demandInfluenceRadius },
      chunkSize,
    );
    const maxChunk = chunkCoordinateForPosition(
      { x: position.x + demandInfluenceRadius, y: position.y + demandInfluenceRadius },
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
      seedInfluenceRadius: demandInfluenceRadius,
      seedInfluence: (position, kind) =>
        calculateDistrictSeedInfluence({
          seeds,
          position,
          kind,
          radius: demandInfluenceRadius,
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
    citizen.tripStartedTick = null;
    completedTrips += 1;
  };

  const startTrip = (
    citizen: CitizenState,
    activity: CitizenActivity,
    destinationId: string,
  ): void => {
    const destination = buildingById(destinationId);
    const result = findGridPathDetailed(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        isWalkable: (position) => spatial.isWalkable(position),
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
    citizen.route = result.path.map(copyPosition);
    citizen.routeIndex = 0;
    citizen.tripStartedTick = tick;
    if (citizen.route.length === 1) completeTrip(citizen, destinationId);
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
      radius: demandInfluenceRadius,
    });

  const reachableDistances = (): Map<string, number> => {
    const distances = new Map<string, number>();
    const queue: GridPosition[] = [];
    const starts = [...buildings]
      .sort(
        (left, right) =>
          comparePositions(left.entrance, right.entrance) ||
          compareDevelopmentBuildingTypes(left.type, right.type) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map((building) => building.entrance);
    for (const start of starts) {
      const startKey = coordinateKey(start);
      if (!spatial.isPositionActive(start) || !spatial.isWalkable(start)) continue;
      if (distances.has(startKey)) continue;
      distances.set(startKey, 0);
      queue.push(copyPosition(start));
    }
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const current = queue[queueIndex];
      queueIndex += 1;
      if (current === undefined) continue;
      const currentDistance = distances.get(coordinateKey(current));
      if (currentDistance === undefined) continue;
      for (const direction of developmentDirections) {
        const next = { x: current.x + direction.x, y: current.y + direction.y };
        if (!Number.isSafeInteger(next.x) || !Number.isSafeInteger(next.y)) continue;
        const nextKey = coordinateKey(next);
        if (distances.has(nextKey) || !spatial.isWalkable(next)) continue;
        distances.set(nextKey, currentDistance + 1);
        queue.push(next);
      }
    }
    return distances;
  };

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
    ];
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
      if (!spatial.isPositionActive(citizen.position) || !spatial.isWalkable(citizen.position)) {
        throw new Error(`Citizen ${citizen.id} is outside active walkable space.`);
      }
      if (blockedCells.has(coordinateKey(citizen.position))) {
        throw new Error(`Citizen ${citizen.id} occupies a blocked interior.`);
      }
      if (
        !spatial.isPositionActive(citizen.previousPosition) ||
        !spatial.isWalkable(citizen.previousPosition) ||
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
        if (!spatial.isPositionActive(position) || !spatial.isWalkable(position)) {
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
    if (!spatial.isWalkable(start) || !spatial.isWalkable(goal)) return false;
    const result = findGridPathDetailed(
      {
        chunkSize,
        activeChunks: spatial.getActiveChunks(),
        isWalkable: (position) =>
          spatial.isWalkable(position) && !blocked.has(coordinateKey(position)),
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

  const canReserveCandidate = (candidate: DevelopmentCandidate): boolean => {
    const footprint = footprintCells(candidate.footprint);
    const blocked = new Set(footprint.map(coordinateKey));
    const existingEntrances = buildings.map((building) => building.entrance).sort(comparePositions);
    if (
      !existingEntrances.some((entrance) =>
        pathExistsWithBlockedCells(entrance, candidate.entrance, blocked),
      )
    ) {
      return false;
    }
    const home = buildings.find((building) => building.type === 'home');
    const workplace = buildings.find((building) => building.type === 'workplace');
    if (home === undefined || workplace === undefined) return false;
    if (!pathExistsWithBlockedCells(home.entrance, workplace.entrance, blocked)) return false;
    for (const citizen of citizens) {
      if (blocked.has(coordinateKey(citizen.position))) return false;
      if (citizen.route.some((position) => blocked.has(coordinateKey(position)))) return false;
      if (citizen.activity === 'commuting-to-work') {
        if (!pathExistsWithBlockedCells(citizen.position, workplace.entrance, blocked))
          return false;
      } else if (citizen.activity === 'commuting-home') {
        if (!pathExistsWithBlockedCells(citizen.position, home.entrance, blocked)) return false;
      }
    }
    return true;
  };

  const capacityForDevelopment = (buildingType: BuildingType): number =>
    buildingType === 'home' ? developmentHomeCapacity : developmentWorkplaceCapacity;

  const startConstruction = (candidate: DevelopmentCandidate): void => {
    if (!canReserveCandidate(candidate)) return;
    const footprint = footprintCells(candidate.footprint);
    spatial.blockMany(footprint);
    const project: ConstructionProjectState = {
      id: `construction-project-${String(nextConstructionProjectId)}`,
      buildingType: candidate.buildingType,
      footprint: { ...candidate.footprint },
      entrance: copyPosition(candidate.entrance),
      capacity: capacityForDevelopment(candidate.buildingType),
      phase: 'survey',
      phaseTicksRemaining: constructionPhaseDurations.survey,
      phaseTicksElapsed: 0,
      totalTicksElapsed: 0,
      startedTick: tick,
      score: candidate.score,
      primaryReason: { ...candidate.primaryReason },
      seedInfluence: candidate.seedInfluence,
      spatialFactor: candidate.spatialFactor,
      expectedAccessImprovement: candidate.expectedAccessImprovement,
    };
    constructionProjects.push(project);
    nextConstructionProjectId += 1;
    constructionProjectsStarted += 1;
    developmentStateVersion += 1;
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
    nextBuildingSequence[project.buildingType] = sequence + 1;
    constructionProjectsCompleted += 1;
    developmentStateVersion += 1;
    markAllDemandChunksDirty();
  };

  const advanceConstructionProjects = (): void => {
    for (let index = constructionProjects.length - 1; index >= 0; index -= 1) {
      const project = constructionProjects[index];
      if (project === undefined) continue;
      project.phaseTicksRemaining -= 1;
      project.phaseTicksElapsed += 1;
      project.totalTicksElapsed += 1;
      if (project.phaseTicksRemaining > 0) continue;
      const nextPhase = nextConstructionPhase(project.phase);
      if (nextPhase === undefined) {
        completeConstructionProject(project);
        constructionProjects.splice(index, 1);
        continue;
      }
      project.phase = nextPhase;
      project.phaseTicksRemaining = constructionPhaseDurations[nextPhase];
      project.phaseTicksElapsed = 0;
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
    nextCitizenSequence += 1;
    return true;
  };

  const evaluateDevelopers = (): void => {
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
  };

  const advanceCitizen = (citizen: CitizenState): void => {
    citizen.previousPosition = copyPosition(citizen.position);
    if (citizen.activity === 'home' || citizen.activity === 'work') {
      citizen.activityTicksRemaining -= 1;
      if (citizen.activityTicksRemaining <= 0) {
        if (citizen.activity === 'home') {
          startTrip(citizen, 'commuting-to-work', citizen.workplaceBuildingId);
        } else {
          completedActivities += 1;
          startTrip(citizen, 'commuting-home', citizen.homeBuildingId);
        }
      }
      return;
    }

    const nextIndex = citizen.routeIndex + 1;
    const next = citizen.route[nextIndex];
    if (next === undefined) throw new Error(`Citizen ${citizen.id} has an incomplete route.`);
    if (manhattanDistance(next, citizen.position) !== 1) {
      throw new Error(`Citizen ${citizen.id} route contains a non-adjacent move.`);
    }
    if (!spatial.isWalkable(next)) throw new Error(`Citizen ${citizen.id} entered a blocked cell.`);
    citizen.position = copyPosition(next);
    citizen.routeIndex = nextIndex;
    if (citizen.routeIndex === citizen.route.length - 1) {
      const destinationId =
        citizen.activity === 'commuting-to-work'
          ? citizen.workplaceBuildingId
          : citizen.homeBuildingId;
      completeTrip(citizen, destinationId);
    }
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
    };
    return {
      chunkSize,
      activeChunkCount: demand.activeChunks.length,
      activeChunks: demand.activeChunks,
      seed,
      tick,
      randomState: random.getState(),
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
      structural,
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
      citizens: citizens.map((citizen): CitizenSnapshot => ({
        id: citizen.id,
        position: copyPosition(citizen.position),
        previousPosition: copyPosition(citizen.previousPosition),
        homeBuildingId: citizen.homeBuildingId,
        workplaceBuildingId: citizen.workplaceBuildingId,
        activity: citizen.activity,
        activityTicksRemaining: citizen.activityTicksRemaining,
        route: citizen.route.map(copyPosition),
        routeIndex: citizen.routeIndex,
      })),
      developmentCandidates: lastDevelopmentCandidates.map((candidate) => ({
        ...candidate,
        anchor: copyPosition(candidate.anchor),
        footprint: { ...candidate.footprint },
        entrance: copyPosition(candidate.entrance),
        primaryReason: { ...candidate.primaryReason },
      })),
      constructionProjects: constructionProjects.map((project): ConstructionProject => ({
        id: project.id,
        buildingType: project.buildingType,
        footprint: { ...project.footprint },
        entrance: copyPosition(project.entrance),
        capacity: project.capacity,
        phase: project.phase,
        phaseTicksRemaining: project.phaseTicksRemaining,
        phaseTicksElapsed: project.phaseTicksElapsed,
        totalTicksElapsed: project.totalTicksElapsed,
        startedTick: project.startedTick,
        score: project.score,
        primaryReason: { ...project.primaryReason },
        seedInfluence: project.seedInfluence,
        spatialFactor: project.spatialFactor,
        expectedAccessImprovement: project.expectedAccessImprovement,
      })),
    };
  };

  return {
    step(): void {
      const metricsBefore = calculateMetrics().metrics;
      const activitiesBefore = completedActivities;
      tick += 1;
      for (const citizen of citizens) advanceCitizen(citizen);
      advanceConstructionProjects();
      const populationGrew = tick % populationGrowthCadenceTicks === 0 ? growPopulation() : false;
      const metricsAfter = calculateMetrics().metrics;
      if (populationGrew || !sameMetrics(metricsBefore, metricsAfter)) {
        markAllDemandChunksDirty();
        developmentStateVersion += 1;
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
      if (tick % developmentEvaluationIntervalTicks === 0) evaluateDevelopers();
      assertPopulationInvariants();
    },
    previewDistrictSeed(command: PlaceDistrictSeedCommand): DistrictSeedPlacementPreview {
      const validation = validateDistrictSeedPlacement(command);
      return validation.accepted
        ? { valid: true, cost: validation.cost }
        : { valid: false, reason: validation.reason };
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
