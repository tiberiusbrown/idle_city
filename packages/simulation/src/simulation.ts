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
  createChunkSpatialStore,
  DEFAULT_CHUNK_SIZE,
  enumerateChunkRegion,
  validateChunkSize,
} from './chunks';
import { getDistrictSeedCost, isDistrictSeedKindUnlocked } from './balance-rules';
import { calculateDemandChunk } from './demand';
import { calculateDistrictSeedInfluence } from './district-seeds';
import { buildingFootprint, footprintCells, selectExteriorEntrance } from './footprints';
import { findGridPathDetailed } from './pathfinding';
import { SeededRandom } from './random';
import type {
  ActivateChunkCommand,
  ActiveChunkSnapshot,
  Building,
  ChunkActivationResult,
  ChunkRegion,
  CitizenActivity,
  CitizenSnapshot,
  CityMetrics,
  CommandResult,
  DemandCell,
  DemandChunkSnapshot,
  DemandRegionQuery,
  DemandRegionSnapshot,
  DemandTotals,
  DistrictSeed,
  DistrictSeedKind,
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

const defaults = {
  chunkSize: DEFAULT_CHUNK_SIZE,
  initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 } as const,
  activeChunkLimit: 256,
  demandQueryMaxCells: 4_096,
  seed: 1,
  citizenCount: 10,
  activityDurationTicks: 3,
  startingData: 0,
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
  const citizenCount = positiveInteger(
    'citizenCount',
    config.citizenCount ?? defaults.citizenCount,
  );
  const activityDurationTicks = positiveInteger(
    'activityDurationTicks',
    config.activityDurationTicks ?? defaults.activityDurationTicks,
  );
  const housingCapacity = nonNegativeInteger(
    'housingCapacity',
    config.housingCapacity ?? citizenCount,
  );
  const workplaceCapacity = nonNegativeInteger(
    'workplaceCapacity',
    config.workplaceCapacity ?? citizenCount,
  );
  const startingData = roundData(
    nonNegativeNumber('startingData', config.startingData ?? defaults.startingData),
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
  const citizens: CitizenState[] = Array.from({ length: citizenCount }, (_, index) => ({
    id: `citizen-${String(index + 1)}`,
    position: copyPosition(homeBuilding.entrance),
    previousPosition: copyPosition(homeBuilding.entrance),
    homeBuildingId: homeBuilding.id,
    workplaceBuildingId: workplaceBuilding.id,
    activity: 'home',
    activityTicksRemaining: 1 + random.nextInteger(activityDurationTicks),
    route: [],
    routeIndex: 0,
    tripStartedTick: null,
  }));

  let tick = 0;
  let completedTrips = 0;
  let completedActivities = 0;
  let totalTripDurationTicks = 0;
  let data = startingData;
  let dataGeneratedThisTick = 0;
  const seeds: DistrictSeed[] = [];
  let nextSeedId = 1;
  let demandChunksDirtied = 0;
  let demandChunksEvaluated = 0;
  let pathNodesExpanded = 0;
  let pathChunksTouched = 0;
  const demandChunks = new Map<string, DemandChunkState>();
  const demandCitizens = citizens.map(({ homeBuildingId, workplaceBuildingId }) => ({
    homeBuildingId,
    workplaceBuildingId,
  }));

  const isDistrictSeedKind = (value: unknown): value is DistrictSeedKind =>
    value === 'living' || value === 'working' || value === 'services';

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
      citizens: demandCitizens,
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
    for (const chunk of spatial.getActiveChunks()) {
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
    refreshDirtyDemandChunks();
    const activeChunks: ActiveChunkSnapshot[] = [];
    let totals = zeroTotals();
    for (const chunk of spatial.getActiveChunks()) {
      const state = demandChunks.get(chunkKey(chunk));
      if (state?.values === undefined) {
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
    };
    return {
      chunkSize,
      activeChunkCount: demand.activeChunks.length,
      activeChunks: demand.activeChunks,
      seed,
      tick,
      randomState: random.getState(),
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
    };
  };

  return {
    step(): void {
      const metricsBefore = calculateMetrics().metrics;
      const activitiesBefore = completedActivities;
      tick += 1;
      for (const citizen of citizens) advanceCitizen(citizen);
      const metricsAfter = calculateMetrics().metrics;
      if (!sameMetrics(metricsBefore, metricsAfter)) markAllDemandChunksDirty();
      const activitiesCompletedThisTick = completedActivities - activitiesBefore;
      dataGeneratedThisTick = 0;
      if (activitiesCompletedThisTick > 0) {
        dataGeneratedThisTick = roundData(
          activitiesCompletedThisTick * dataEfficiency(metricsAfter),
        );
        data = roundData(data + dataGeneratedThisTick);
      }
    },
    placeDistrictSeed(command: PlaceDistrictSeedCommand): CommandResult {
      const requestedPosition = command.position;
      if (
        !Number.isSafeInteger(requestedPosition.x) ||
        !Number.isSafeInteger(requestedPosition.y)
      ) {
        return { accepted: false, reason: 'out-of-bounds' };
      }
      if (!spatial.isPositionActive(requestedPosition)) {
        return { accepted: false, reason: 'inactive-chunk' };
      }
      if (seeds.some((districtSeed) => positionsEqual(districtSeed.position, requestedPosition))) {
        return { accepted: false, reason: 'occupied' };
      }
      const requestedKind = command.kind;
      if (!isDistrictSeedKind(requestedKind)) {
        return { accepted: false, reason: 'invalid-kind' };
      }
      if (!isDistrictSeedKindUnlocked(requestedKind)) {
        return { accepted: false, reason: 'locked' };
      }
      const cost = getDistrictSeedCost(requestedKind);
      if (data < cost) return { accepted: false, reason: 'insufficient-data' };
      const districtSeed: DistrictSeed = {
        id: `district-seed-${String(nextSeedId)}`,
        kind: requestedKind,
        position: copyPosition(requestedPosition),
      };
      seeds.push(districtSeed);
      nextSeedId += 1;
      data = roundData(data - cost);
      markDemandAroundPosition(requestedPosition);
      return {
        accepted: true,
        seed: { ...districtSeed, position: copyPosition(districtSeed.position) },
        cost,
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
      markDemandForActivation(requested);
      return {
        accepted: true,
        chunk: copyChunk(requested),
        activeChunkCount: spatial.getActiveChunks().length,
      };
    },
    getDemandChunk(chunk: ChunkCoordinate): DemandChunkSnapshot | undefined {
      if (!Number.isSafeInteger(chunk.x) || !Number.isSafeInteger(chunk.y)) return undefined;
      if (!spatial.isActive(chunk)) return undefined;
      return copyDemandChunk(evaluateDemandChunk(chunk));
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
          const state = evaluateDemandChunk(chunk);
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
