import {
  createBuildingId,
  createCitizenId,
  createGridRect,
  createGridPosition,
  createZoneId,
  type BuildingId,
  stableHash,
  type CitizenId,
  type GridPosition,
  type GridRect,
  type ZoneId,
} from '@idle-city/shared';
import {
  cloneBuildingInstance,
  createBuildingInstance,
  createBuildingSnapshot,
  BUILDING_ARCHETYPE_ORDER,
  getBuildingArchetype,
  type BuildingArchetypeId,
  type BuildingGeometry,
  type BuildingInstance,
  type BuildingSnapshot,
  type BuildingTransform,
} from './buildings';
import { createAStarSearch, type AStarAdvanceResult, type AStarSearch } from './pathfinding';
import {
  createBuildingPassabilityCallback,
  decrementBuildingActivityTicks,
  isBuildingPassable,
  selectBuildingDestinationCell,
  selectInternalBuildingDestinationCell,
} from './navigation';
import {
  calculatePlanningChance,
  calculateZoneFreeSpaceRatio,
  comparePlanningZoneIds,
  keyedPlanningUnit,
  orderPlanningAnchors,
  orderPlanningTransforms,
  planningRollSucceeds,
  validatePlanningCandidate,
  DEFAULT_PLANNING_CHANCE,
} from './planning';
import {
  movementCellKey,
  resolveMovementProposals,
  type MovementParticipant,
  type MovementProposal,
  type MovementResolution,
} from './movement';
import {
  cloneWorld,
  createWorld,
  ensureChunkAt,
  ensureChunksForRect,
  getSortedChunks,
  type WorldState,
} from './world';

export type { BuildingId, CitizenId, GridPosition, GridRect, ZoneId } from '@idle-city/shared';
export {
  CHUNK_SIZE,
  createGridRect,
  getChunkCoordinates,
  getChunkKey,
  getChunkLocalPosition,
} from '@idle-city/shared';
export type { ChunkCoordinates } from '@idle-city/shared';
export { createAStarSearch } from './pathfinding';
export {
  createBuildingPassabilityCallback,
  createBuildingTrip,
  decrementBuildingActivityTicks,
  isBuildingPassable,
  selectBuildingDestinationCell,
  selectInternalBuildingDestinationCell,
} from './navigation';
export type {
  BuildingDestinationCellOptions,
  BuildingPassabilityOptions,
  BuildingTrip,
  BuildingTripOptions,
} from './navigation';
export type {
  AStarAdvanceResult,
  AStarAdvanceStatus,
  AStarSearch,
  AStarSearchOptions,
  AStarSearchStatus,
} from './pathfinding';
export { movementCellKey, resolveMovementProposals } from './movement';
export type {
  AcceptedMovement,
  MovementParticipant,
  MovementProposal,
  MovementProposalKind,
  MovementResolution,
  MovementResolutionOptions,
} from './movement';
export * from './buildings';
export {
  calculatePlanningChance,
  calculateZoneFreeSpaceRatio,
  DEFAULT_PLANNING_CHANCE,
} from './planning';

export const FIXED_POINT_UNITS_PER_CELL = 1024;
export const DEFAULT_CITIZEN_MOVEMENT_SPEED = 512;
export const WANDERING_CHEBYSHEV_RADIUS = 16;
export const DEFAULT_HOME_STAY_TICKS = 75;
export const DEFAULT_WORK_STAY_TICKS = 50;
export const DEFAULT_POPULATION_GROWTH_COEFFICIENT = 0.02;
export const MAX_POPULATION_GROWTH_CHANCE = 0.1;
/** Generic activity duration retained for compatibility with the earlier activity model. */
export const DEFAULT_GENERIC_BUILDING_ACTIVITY_TICKS = 1;

/** Compatibility aliases for callers that name the balance values directly. */
export const MOVEMENT_UNITS_PER_CELL = FIXED_POINT_UNITS_PER_CELL;
export const CITIZEN_MOVEMENT_SPEED = DEFAULT_CITIZEN_MOVEMENT_SPEED;
export const WANDER_RADIUS = WANDERING_CHEBYSHEV_RADIUS;

export type ZoneType = 'living' | 'working' | 'leisure';

export interface ZoneDefinition {
  readonly width: number;
  readonly height: number;
  readonly baseCost: number;
}

function createZoneDefinition(width: number, height: number, baseCost: number): ZoneDefinition {
  return Object.freeze({ width, height, baseCost });
}

export const ZONE_DEFINITIONS: Readonly<Record<ZoneType, ZoneDefinition>> = Object.freeze({
  living: createZoneDefinition(13, 13, 4),
  working: createZoneDefinition(13, 13, 6),
  leisure: createZoneDefinition(8, 8, 40),
});

export function isZoneType(value: unknown): value is ZoneType {
  return value === 'living' || value === 'working' || value === 'leisure';
}

/** Calculates the next cost from the number of active zones of the same type. */
export function calculateZoneCost(zoneType: ZoneType, activeSameTypeZoneCount: number): number {
  if (!Number.isSafeInteger(activeSameTypeZoneCount) || activeSameTypeZoneCount < 0) {
    throw new Error(
      `Active zone counts must be nonnegative safe integers; received ${String(activeSameTypeZoneCount)}.`,
    );
  }

  const definition = ZONE_DEFINITIONS[zoneType];
  const cost = Math.ceil(definition.baseCost * 1.25 ** activeSameTypeZoneCount);
  if (!Number.isSafeInteger(cost)) {
    throw new Error(`Zone cost exceeded the safe integer range for ${zoneType}.`);
  }
  return cost;
}

export interface ZoneSnapshot {
  readonly id: ZoneId;
  readonly type: ZoneType;
  readonly rect: GridRect;
  readonly placementTick: number;
  readonly immediatePlanningOpportunity: boolean;
  readonly planningSequence: number;
  readonly planningSaturated: boolean;
}

export interface PlaceZoneCommand {
  readonly type: 'place-zone';
  readonly zoneType: ZoneType;
  readonly rect: GridRect;
  readonly expectedCost: number;
}

export type SimulationCommand = PlaceZoneCommand;

export type PlaceZoneRejectionReason =
  | 'invalid-type'
  | 'invalid-dimensions'
  | 'invalid-coordinates'
  | 'invalid-cost'
  | 'stale-cost'
  | 'overlap'
  | 'insufficient-data';

export interface ZonePlacementPreview {
  readonly valid: boolean;
  readonly rect: GridRect;
  readonly currentCost: number;
  readonly reason?: PlaceZoneRejectionReason;
}

export type PlaceZoneCommandResult =
  | {
      readonly accepted: true;
      readonly tick: number;
      readonly cost: number;
      readonly zone: ZoneSnapshot;
    }
  | {
      readonly accepted: false;
      readonly tick: number;
      readonly currentCost: number;
      readonly reason: PlaceZoneRejectionReason;
    };

export interface SimulationOptions {
  readonly seed?: number;
  /** Overrides the default 0.02 planning coefficient for controlled scenarios. */
  readonly planningChance?: number;
  /** Test-only balance overrides for keeping focused construction tests short. */
  readonly constructionLaborRequirements?: Partial<Record<BuildingArchetypeId, number>>;
  /** Test-only override for the authoritative home-stay duration. */
  readonly homeStayTicks?: number;
  /** Test-only override for the authoritative work-stay duration. */
  readonly workStayTicks?: number;
  /** Test-only keyed-roll override for forcing a population-growth outcome. */
  readonly populationGrowthRollOverride?: number;
}

/** The authoritative order of work inside one logical tick. */
export const TICK_STAGE_ORDER = [
  'apply-queued-commands',
  'apply-zone-removals',
  'freeze-citizen-occupancy',
  'decrement-timers',
  'complete-expired-activities',
  'mark-citizens-requiring-goal',
  'fill-construction-assignments',
  'select-non-construction-goals',
  'advance-path-planning',
  'accrue-movement-credit',
  'generate-movement-proposals',
  'resolve-movement-conflicts',
  'commit-accepted-movement',
  'process-arrivals',
  'start-building-activities',
  'produce-workplace-data',
  'apply-construction-labor',
  'complete-buildings',
  'apply-assignment-changes',
  'evaluate-population-growth',
  'advance-building-planning',
  'commit-completed-tick',
] as const;

export type TickStage = (typeof TICK_STAGE_ORDER)[number];

export interface TickWorkResult {
  readonly status: 'in-progress' | 'committed';
  /** The last stage that consumed work in this call. */
  readonly stage: TickStage;
  readonly workUnitsConsumed: number;
}

export interface MovementMetrics {
  readonly movementProposals: number;
  readonly committedMoves: number;
  readonly blockedMoves: number;
  readonly pathfindingExpansions: number;
  readonly planningAttempts: number;
  readonly planningSuccesses: number;
  readonly planningCandidateChecks: number;
  readonly populationGrowthAttempts: number;
  readonly populationGrowthSuccesses: number;
}

export type PlanningJobStatus = 'idle' | 'accepted' | 'saturated';

/** The last completed planning job, without exposing private candidate lists. */
export interface PlanningJobSnapshot {
  readonly status: PlanningJobStatus;
  readonly zoneId: ZoneId | null;
  readonly archetypeId: BuildingArchetypeId | null;
  readonly planningSequence: number;
  readonly candidateChecks: number;
}

export type CitizenTripPurpose = 'construction' | 'home' | 'work';

export type BuildingActivityKind = 'generic' | 'construction' | 'home-stay' | 'work-stay';

export interface CitizenRouteSnapshot {
  readonly purpose: CitizenTripPurpose;
  readonly sourceBuildingId: BuildingId | null;
  readonly destinationBuildingId: BuildingId | null;
  readonly destinationCell: GridPosition | null;
  readonly tripSequence: number;
}

export interface BuildingActivitySnapshot {
  readonly buildingId: BuildingId;
  readonly kind: BuildingActivityKind;
  readonly ticksRemaining: number;
  readonly internalWanderingSequence: number;
}

export interface CitizenSnapshot {
  readonly id: CitizenId;
  readonly position: GridPosition;
  readonly previousPosition: GridPosition;
  readonly movementCredit: number;
  readonly wanderingAnchor: GridPosition;
  readonly homeBuildingId: BuildingId | null;
  readonly workBuildingId: BuildingId | null;
  readonly constructionBuildingId: BuildingId | null;
  readonly route: CitizenRouteSnapshot | null;
  readonly activity: BuildingActivitySnapshot | null;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly data: number;
  readonly population: number;
  readonly completedHomeCapacity: number;
  readonly citizens: readonly CitizenSnapshot[];
  readonly zones: readonly ZoneSnapshot[];
  readonly nextZoneCosts: Readonly<Record<ZoneType, number>>;
  readonly buildings: readonly BuildingSnapshot[];
  readonly planningJob: PlanningJobSnapshot;
}

export interface Simulation {
  advanceTickWork(maxWorkUnits: number): TickWorkResult;
  /** Queues a command for the next tick command stage. */
  queueCommand(command: SimulationCommand): void;
  /** Queues the narrow placement command; retained as the direct public verb. */
  placeZone(command: PlaceZoneCommand): void;
  getZonePlacementPreview(command: PlaceZoneCommand): ZonePlacementPreview;
  getLastCommandResults(): readonly PlaceZoneCommandResult[];
  getSnapshot(): SimulationSnapshot;
  getMetrics(): MovementMetrics;
  getDeterminismHash(): string;
}

interface MutableMovementMetrics {
  movementProposals: number;
  committedMoves: number;
  blockedMoves: number;
  pathfindingExpansions: number;
  planningAttempts: number;
  planningSuccesses: number;
  planningCandidateChecks: number;
  populationGrowthAttempts: number;
  populationGrowthSuccesses: number;
}

interface CitizenRouteState {
  readonly purpose: CitizenTripPurpose;
  readonly sourceBuildingId: BuildingId | null;
  readonly destinationBuildingId: BuildingId | null;
  readonly destinationCell: GridPosition | null;
  readonly tripSequence: number;
}

interface BuildingActivityState {
  buildingId: BuildingId;
  kind: BuildingActivityKind;
  ticksRemaining: number;
  internalWanderingSequence: number;
}

interface CitizenState {
  readonly id: CitizenId;
  position: GridPosition;
  previousPosition: GridPosition;
  movementCredit: number;
  readonly movementSpeed: number;
  blockedMovementCount: number;
  wanderingAnchor: GridPosition;
  wanderingTarget: GridPosition;
  wanderingSequence: number;
  path: GridPosition[] | null;
  pathIndex: number;
  goalStartTick: number;
  tripSequence: number;
  homeBuildingId: BuildingId | null;
  workBuildingId: BuildingId | null;
  constructionBuildingId: BuildingId | null;
  route: CitizenRouteState | null;
  activity: BuildingActivityState | null;
  internalTarget: GridPosition | null;
  internalPath: GridPosition[] | null;
  internalPathIndex: number;
  internalPathNeedsReplan: boolean;
  routeNeedsReplan: boolean;
  replanWithOccupancy: boolean;
}

interface ZoneState {
  readonly id: ZoneId;
  readonly type: ZoneType;
  readonly rect: GridRect;
  readonly placementTick: number;
  readonly immediatePlanningOpportunity: boolean;
  immediatePlanningPending: boolean;
  planningSequence: number;
  planningSaturated: boolean;
}

interface AuthoritativeState {
  readonly seed: number;
  readonly tick: number;
  data: number;
  readonly homeStayTicks: number;
  readonly workStayTicks: number;
  readonly citizens: CitizenState[];
  readonly zones: ZoneState[];
  readonly buildings: BuildingInstance[];
  nextZoneId: number;
  nextBuildingId: number;
  nextCitizenId: number;
  readonly world: WorldState;
  readonly metrics: MutableMovementMetrics;
  readonly planningChance: number;
  readonly constructionLaborRequirements: Readonly<Record<BuildingArchetypeId, number>>;
  lastPlanningJob: PlanningJobSnapshot;
  movementNoProgressTicks: number;
  populationGrowthSequence: number;
  populationGrowthRollOverride: number | null;
}

interface SelectedPlanningCandidate {
  readonly origin: GridPosition;
  readonly transform: BuildingTransform;
  readonly geometry: BuildingGeometry;
}

interface BuildingPlanningJob {
  readonly zoneId: ZoneId;
  readonly archetypeId: BuildingArchetypeId;
  readonly archetypeOrder: readonly BuildingArchetypeId[];
  readonly transformOrder: readonly BuildingTransform[];
  readonly anchorOrder: readonly GridPosition[];
  readonly planningSequence: number;
  candidateCursor: number;
  validCandidatesFound: number;
  workConsumed: number;
  selectedCandidate: SelectedPlanningCandidate | null;
}

/**
 * Each stage owns a cursor. A path-planning or proposal stage may consume
 * several work units while keeping its cursor private to the pending tick.
 */
interface StageCursor {
  workIndex: number;
}

interface TickCursors {
  readonly applyQueuedCommands: StageCursor;
  readonly applyZoneRemovals: StageCursor;
  readonly freezeCitizenOccupancy: StageCursor;
  readonly decrementTimers: StageCursor;
  readonly completeExpiredActivities: StageCursor;
  readonly markCitizensRequiringGoal: StageCursor;
  readonly fillConstructionAssignments: StageCursor;
  readonly selectNonConstructionGoals: StageCursor;
  readonly advancePathPlanning: StageCursor;
  readonly accrueMovementCredit: StageCursor;
  readonly generateMovementProposals: StageCursor;
  readonly resolveMovementConflicts: StageCursor;
  readonly commitAcceptedMovement: StageCursor;
  readonly processArrivals: StageCursor;
  readonly startBuildingActivities: StageCursor;
  readonly produceWorkplaceData: StageCursor;
  readonly applyConstructionLabor: StageCursor;
  readonly completeBuildings: StageCursor;
  readonly applyAssignmentChanges: StageCursor;
  readonly evaluatePopulationGrowth: StageCursor;
  readonly advanceBuildingPlanning: StageCursor;
  readonly commitCompletedTick: StageCursor;
}

interface PendingTick {
  readonly nextState: AuthoritativeState;
  readonly cursors: TickCursors;
  readonly commands: readonly SimulationCommand[];
  readonly commandResults: PlaceZoneCommandResult[];
  nextStageIndex: number;
  occupancy: Map<string, CitizenId> | null;
  readonly pathSearches: Map<CitizenId, AStarSearch>;
  readonly proposals: MovementProposal[];
  readonly arrivedBuildingIds: Map<CitizenId, ArrivedBuilding>;
  readonly completedBuildingIds: Set<BuildingId>;
  movementResolution: MovementResolution | null;
  planningJob: BuildingPlanningJob | null;
}

interface ArrivedBuilding {
  readonly buildingId: BuildingId;
  readonly purpose: CitizenTripPurpose;
}

const INITIAL_CITIZEN_POSITIONS: readonly GridPosition[] = [
  createGridPosition(0, 0),
  createGridPosition(1, 0),
  createGridPosition(0, 1),
  createGridPosition(1, 1),
];

function createMutableMetrics(): MutableMovementMetrics {
  return {
    movementProposals: 0,
    committedMoves: 0,
    blockedMoves: 0,
    pathfindingExpansions: 0,
    planningAttempts: 0,
    planningSuccesses: 0,
    planningCandidateChecks: 0,
    populationGrowthAttempts: 0,
    populationGrowthSuccesses: 0,
  };
}

function copyMetrics(metrics: MutableMovementMetrics): MutableMovementMetrics {
  return {
    movementProposals: metrics.movementProposals,
    committedMoves: metrics.committedMoves,
    blockedMoves: metrics.blockedMoves,
    pathfindingExpansions: metrics.pathfindingExpansions,
    planningAttempts: metrics.planningAttempts,
    planningSuccesses: metrics.planningSuccesses,
    planningCandidateChecks: metrics.planningCandidateChecks,
    populationGrowthAttempts: metrics.populationGrowthAttempts,
    populationGrowthSuccesses: metrics.populationGrowthSuccesses,
  };
}

function createIdlePlanningJobSnapshot(): PlanningJobSnapshot {
  return {
    status: 'idle',
    zoneId: null,
    archetypeId: null,
    planningSequence: 0,
    candidateChecks: 0,
  };
}

function validateSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`Simulation seeds must be safe integers; received ${String(seed)}.`);
  }
  return seed;
}

function validatePlanningChance(planningChance: number): number {
  if (!Number.isFinite(planningChance) || planningChance < 0 || planningChance > 1) {
    throw new Error(
      `Planning chance must be a finite number between 0 and 1; received ${String(planningChance)}.`,
    );
  }
  return planningChance;
}

function validateActivityDuration(name: string, ticks: number): number {
  if (!Number.isSafeInteger(ticks) || ticks <= 0) {
    throw new Error(`${name} must be a positive safe integer; received ${String(ticks)}.`);
  }
  return ticks;
}

function validatePopulationGrowthRollOverride(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `Population growth roll overrides must be finite numbers between 0 and 1; received ${String(value)}.`,
    );
  }
  return value;
}

function createConstructionLaborRequirements(
  overrides: Partial<Record<BuildingArchetypeId, number>> | undefined,
): Readonly<Record<BuildingArchetypeId, number>> {
  const requirements = {} as Record<BuildingArchetypeId, number>;
  for (const archetypeId of BUILDING_ARCHETYPE_ORDER) {
    requirements[archetypeId] = getBuildingArchetype(archetypeId).labor;
  }

  for (const [archetypeId, requirement] of Object.entries(overrides ?? {})) {
    if (!BUILDING_ARCHETYPE_ORDER.includes(archetypeId as BuildingArchetypeId)) {
      throw new Error(`Unknown construction labor archetype ${archetypeId}.`);
    }
    if (!Number.isSafeInteger(requirement) || requirement <= 0) {
      throw new Error(
        `Construction labor requirements must be positive safe integers; received ${String(requirement)}.`,
      );
    }
    requirements[archetypeId as BuildingArchetypeId] = requirement;
  }

  return Object.freeze(requirements);
}

function copyPosition(position: GridPosition): GridPosition {
  return createGridPosition(position.x, position.y);
}

function copyRoute(route: CitizenRouteState | null): CitizenRouteState | null {
  if (route === null) return null;
  return {
    purpose: route.purpose,
    sourceBuildingId: route.sourceBuildingId,
    destinationBuildingId: route.destinationBuildingId,
    destinationCell: route.destinationCell === null ? null : copyPosition(route.destinationCell),
    tripSequence: route.tripSequence,
  };
}

function copyActivity(activity: BuildingActivityState | null): BuildingActivityState | null {
  if (activity === null) return null;
  return {
    buildingId: activity.buildingId,
    kind: activity.kind,
    ticksRemaining: activity.ticksRemaining,
    internalWanderingSequence: activity.internalWanderingSequence,
  };
}

function copySnapshotPosition(position: GridPosition): GridPosition {
  return { x: position.x, y: position.y };
}

function cellKey(position: GridPosition): string {
  return movementCellKey(position);
}

function isAdjacent(left: GridPosition, right: GridPosition): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function chebyshevDistance(left: GridPosition, right: GridPosition): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function isWithinWanderingBounds(anchor: GridPosition, position: GridPosition): boolean {
  return chebyshevDistance(anchor, position) <= WANDERING_CHEBYSHEV_RADIUS;
}

/** Returns the chance for one population-growth roll in the current state. */
export function calculatePopulationGrowthChance(
  completedHomeCapacity: number,
  population: number,
): number {
  if (
    !Number.isSafeInteger(completedHomeCapacity) ||
    completedHomeCapacity < 0 ||
    !Number.isSafeInteger(population) ||
    population < 0
  ) {
    throw new Error('Population and completed home capacity must be nonnegative safe integers.');
  }
  if (completedHomeCapacity <= population) return 0;

  const pressure =
    population > 0
      ? Math.max(0, completedHomeCapacity / population - 1)
      : completedHomeCapacity > 0
        ? 1
        : 0;
  return Math.min(MAX_POPULATION_GROWTH_CHANCE, DEFAULT_POPULATION_GROWTH_COEFFICIENT * pressure);
}

function createWanderOffsets(): readonly (readonly [number, number])[] {
  const offsets: (readonly [number, number])[] = [];
  for (let y = -WANDERING_CHEBYSHEV_RADIUS; y <= WANDERING_CHEBYSHEV_RADIUS; y += 1) {
    for (let x = -WANDERING_CHEBYSHEV_RADIUS; x <= WANDERING_CHEBYSHEV_RADIUS; x += 1) {
      if (x === 0 && y === 0) continue;
      offsets.push([x, y]);
    }
  }
  return Object.freeze(offsets);
}

const WANDER_OFFSETS = createWanderOffsets();

function keyedWanderOffsetIndex(
  seed: number,
  citizenId: CitizenId,
  wanderingSequence: number,
): number {
  const hash = stableHash({
    seed,
    citizenId,
    wanderingSequence,
    purpose: 'wandering-target',
  });
  return Number.parseInt(hash, 16) % WANDER_OFFSETS.length;
}

function selectWanderTarget(
  seed: number,
  citizenId: CitizenId,
  wanderingSequence: number,
  anchor: GridPosition,
): GridPosition {
  const offset = WANDER_OFFSETS[keyedWanderOffsetIndex(seed, citizenId, wanderingSequence)];
  if (offset === undefined) throw new Error('Wandering offset selection was out of range.');

  const x = anchor.x + offset[0];
  const y = anchor.y + offset[1];
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error('Wandering target exceeded the safe signed grid range.');
  }
  return createGridPosition(x, y);
}

function createCitizenState(id: CitizenId, position: GridPosition): CitizenState {
  return {
    id,
    position: copyPosition(position),
    previousPosition: copyPosition(position),
    movementCredit: 0,
    movementSpeed: DEFAULT_CITIZEN_MOVEMENT_SPEED,
    blockedMovementCount: 0,
    wanderingAnchor: copyPosition(position),
    wanderingTarget: copyPosition(position),
    wanderingSequence: 0,
    path: null,
    pathIndex: 0,
    goalStartTick: 0,
    tripSequence: 0,
    homeBuildingId: null,
    workBuildingId: null,
    constructionBuildingId: null,
    route: null,
    activity: null,
    internalTarget: null,
    internalPath: null,
    internalPathIndex: 0,
    internalPathNeedsReplan: false,
    routeNeedsReplan: false,
    replanWithOccupancy: false,
  };
}

function copyRect(rect: GridRect): GridRect {
  return createGridRect(rect.x, rect.y, rect.width, rect.height);
}

function copyRawRect(rect: GridRect): GridRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function copySnapshotRect(rect: GridRect): GridRect {
  return copyRawRect(rect);
}

function copyZoneState(zone: ZoneState): ZoneState {
  return {
    id: zone.id,
    type: zone.type,
    rect: copyRect(zone.rect),
    placementTick: zone.placementTick,
    immediatePlanningOpportunity: zone.immediatePlanningOpportunity,
    immediatePlanningPending: zone.immediatePlanningPending,
    planningSequence: zone.planningSequence,
    planningSaturated: zone.planningSaturated,
  };
}

function createZoneSnapshot(zone: ZoneState): ZoneSnapshot {
  return {
    id: zone.id,
    type: zone.type,
    rect: copySnapshotRect(zone.rect),
    placementTick: zone.placementTick,
    immediatePlanningOpportunity: zone.immediatePlanningOpportunity,
    planningSequence: zone.planningSequence,
    planningSaturated: zone.planningSaturated,
  };
}

function countZonesByType(zones: readonly ZoneState[]): Record<ZoneType, number> {
  const counts: Record<ZoneType, number> = {
    living: 0,
    working: 0,
    leisure: 0,
  };
  for (const zone of zones) counts[zone.type] += 1;
  return counts;
}

function createNextZoneCosts(zones: readonly ZoneState[]): Readonly<Record<ZoneType, number>> {
  const counts = countZonesByType(zones);
  return {
    living: calculateZoneCost('living', counts.living),
    working: calculateZoneCost('working', counts.working),
    leisure: calculateZoneCost('leisure', counts.leisure),
  };
}

function rectanglesOverlap(left: GridRect, right: GridRect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function isSafeRectCoordinate(value: number): boolean {
  return Number.isSafeInteger(value);
}

function isValidRectShape(rect: GridRect, definition: ZoneDefinition): boolean {
  return (
    isSafeRectCoordinate(rect.width) &&
    isSafeRectCoordinate(rect.height) &&
    rect.width === definition.width &&
    rect.height === definition.height
  );
}

function isValidRectCoordinates(rect: GridRect): boolean {
  return (
    isSafeRectCoordinate(rect.x) &&
    isSafeRectCoordinate(rect.y) &&
    isSafeRectCoordinate(rect.x + rect.width - 1) &&
    isSafeRectCoordinate(rect.y + rect.height - 1)
  );
}

interface ValidatedPlaceZone {
  readonly zoneType: ZoneType;
  readonly rect: GridRect;
  readonly cost: number;
}

type PlaceZoneValidation =
  | { readonly accepted: true; readonly placement: ValidatedPlaceZone }
  | {
      readonly accepted: false;
      readonly reason: PlaceZoneRejectionReason;
      readonly currentCost: number;
    };

function validatePlaceZoneCommand(
  state: AuthoritativeState,
  command: PlaceZoneCommand,
): PlaceZoneValidation {
  if (command.type !== 'place-zone' || !isZoneType(command.zoneType)) {
    return { accepted: false, reason: 'invalid-type', currentCost: 0 };
  }

  const definition = ZONE_DEFINITIONS[command.zoneType];
  const rect = command.rect;
  if (rect === null || typeof rect !== 'object' || !isValidRectShape(rect, definition)) {
    return {
      accepted: false,
      reason: 'invalid-dimensions',
      currentCost: calculateZoneCost(
        command.zoneType,
        countZonesByType(state.zones)[command.zoneType],
      ),
    };
  }

  if (!isValidRectCoordinates(rect)) {
    return {
      accepted: false,
      reason: 'invalid-coordinates',
      currentCost: calculateZoneCost(
        command.zoneType,
        countZonesByType(state.zones)[command.zoneType],
      ),
    };
  }

  const counts = countZonesByType(state.zones);
  const currentCost = calculateZoneCost(command.zoneType, counts[command.zoneType]);
  if (!Number.isSafeInteger(command.expectedCost) || command.expectedCost < 0) {
    return { accepted: false, reason: 'invalid-cost', currentCost };
  }
  if (command.expectedCost !== currentCost) {
    return { accepted: false, reason: 'stale-cost', currentCost };
  }

  const normalizedRect = copyRect(rect);
  if (state.zones.some((zone) => rectanglesOverlap(zone.rect, normalizedRect))) {
    return { accepted: false, reason: 'overlap', currentCost };
  }
  if (state.data < currentCost) {
    return { accepted: false, reason: 'insufficient-data', currentCost };
  }

  return {
    accepted: true,
    placement: { zoneType: command.zoneType, rect: normalizedRect, cost: currentCost },
  };
}

function createInitialState(
  seed: number,
  planningChance: number,
  constructionLaborRequirements: Readonly<Record<BuildingArchetypeId, number>>,
  homeStayTicks: number,
  workStayTicks: number,
  populationGrowthRollOverride: number | undefined,
): AuthoritativeState {
  const validatedSeed = validateSeed(seed);
  const validatedPlanningChance = validatePlanningChance(planningChance);
  const validatedHomeStayTicks = validateActivityDuration('Home-stay duration', homeStayTicks);
  const validatedWorkStayTicks = validateActivityDuration('Work-stay duration', workStayTicks);
  const validatedPopulationGrowthRollOverride = validatePopulationGrowthRollOverride(
    populationGrowthRollOverride,
  );
  const world = createWorld();
  const citizens = INITIAL_CITIZEN_POSITIONS.map((position, index) => {
    const citizen = createCitizenState(createCitizenId(`citizen-${String(index + 1)}`), position);
    ensureChunkAt(world, citizen.position);
    return citizen;
  });

  return {
    seed: validatedSeed,
    tick: 0,
    data: 10,
    homeStayTicks: validatedHomeStayTicks,
    workStayTicks: validatedWorkStayTicks,
    citizens,
    zones: [],
    buildings: [],
    nextZoneId: 1,
    nextBuildingId: 1,
    nextCitizenId: INITIAL_CITIZEN_POSITIONS.length + 1,
    world,
    metrics: createMutableMetrics(),
    planningChance: validatedPlanningChance,
    constructionLaborRequirements,
    lastPlanningJob: createIdlePlanningJobSnapshot(),
    movementNoProgressTicks: 0,
    populationGrowthSequence: 0,
    populationGrowthRollOverride: validatedPopulationGrowthRollOverride,
  };
}

function copyCitizenForPending(citizen: CitizenState): CitizenState {
  return {
    id: citizen.id,
    position: copyPosition(citizen.position),
    previousPosition: copyPosition(citizen.position),
    movementCredit: citizen.movementCredit,
    movementSpeed: citizen.movementSpeed,
    blockedMovementCount: citizen.blockedMovementCount,
    wanderingAnchor: copyPosition(citizen.wanderingAnchor),
    wanderingTarget: copyPosition(citizen.wanderingTarget),
    wanderingSequence: citizen.wanderingSequence,
    path: citizen.path?.map(copyPosition) ?? null,
    pathIndex: citizen.pathIndex,
    goalStartTick: citizen.goalStartTick,
    tripSequence: citizen.tripSequence,
    homeBuildingId: citizen.homeBuildingId,
    workBuildingId: citizen.workBuildingId,
    constructionBuildingId: citizen.constructionBuildingId,
    route: copyRoute(citizen.route),
    activity: copyActivity(citizen.activity),
    internalTarget: citizen.internalTarget === null ? null : copyPosition(citizen.internalTarget),
    internalPath: citizen.internalPath?.map(copyPosition) ?? null,
    internalPathIndex: citizen.internalPathIndex,
    internalPathNeedsReplan: citizen.internalPathNeedsReplan,
    routeNeedsReplan: citizen.routeNeedsReplan,
    replanWithOccupancy: citizen.replanWithOccupancy,
  };
}

function copyPlaceZoneCommand(command: PlaceZoneCommand): PlaceZoneCommand {
  return {
    type: command.type,
    zoneType: command.zoneType,
    rect: copyRawRect(command.rect),
    expectedCost: command.expectedCost,
  };
}

function copyCommandResult(result: PlaceZoneCommandResult): PlaceZoneCommandResult {
  if (!result.accepted) return { ...result };
  return { ...result, zone: { ...result.zone, rect: copySnapshotRect(result.zone.rect) } };
}

function applyPlaceZoneCommand(
  state: AuthoritativeState,
  command: PlaceZoneCommand,
  tick: number,
): PlaceZoneCommandResult {
  const validation = validatePlaceZoneCommand(state, command);
  if (!validation.accepted) {
    return {
      accepted: false,
      tick,
      currentCost: validation.currentCost,
      reason: validation.reason,
    };
  }

  const zone = {
    id: createZoneId(`zone-${String(state.nextZoneId)}`),
    type: validation.placement.zoneType,
    rect: copyRect(validation.placement.rect),
    placementTick: tick,
    immediatePlanningOpportunity: true,
    immediatePlanningPending: true,
    planningSequence: 0,
    planningSaturated: false,
  } satisfies ZoneState;
  state.zones.push(zone);
  state.nextZoneId += 1;
  state.data -= validation.placement.cost;
  ensureChunksForRect(state.world, zone.rect);

  return {
    accepted: true,
    tick,
    cost: validation.placement.cost,
    zone: createZoneSnapshot(zone),
  };
}

function createSnapshot(state: AuthoritativeState): SimulationSnapshot {
  return {
    tick: state.tick,
    data: state.data,
    population: state.citizens.length,
    completedHomeCapacity: calculateCompletedHomeCapacity(state),
    citizens: state.citizens.map((citizen) => ({
      id: citizen.id,
      position: copySnapshotPosition(citizen.position),
      previousPosition: copySnapshotPosition(citizen.previousPosition),
      movementCredit: citizen.movementCredit,
      wanderingAnchor: copySnapshotPosition(citizen.wanderingAnchor),
      homeBuildingId: citizen.homeBuildingId,
      workBuildingId: citizen.workBuildingId,
      constructionBuildingId: citizen.constructionBuildingId,
      route:
        citizen.route === null
          ? null
          : {
              purpose: citizen.route.purpose,
              sourceBuildingId: citizen.route.sourceBuildingId,
              destinationBuildingId: citizen.route.destinationBuildingId,
              destinationCell:
                citizen.route.destinationCell === null
                  ? null
                  : copySnapshotPosition(citizen.route.destinationCell),
              tripSequence: citizen.route.tripSequence,
            },
      activity:
        citizen.activity === null
          ? null
          : {
              buildingId: citizen.activity.buildingId,
              kind: citizen.activity.kind,
              ticksRemaining: citizen.activity.ticksRemaining,
              internalWanderingSequence: citizen.activity.internalWanderingSequence,
            },
    })),
    zones: state.zones.map(createZoneSnapshot),
    nextZoneCosts: createNextZoneCosts(state.zones),
    buildings: state.buildings.map(createBuildingSnapshot),
    planningJob: { ...state.lastPlanningJob },
  };
}

function createMetricsSnapshot(metrics: MutableMovementMetrics): MovementMetrics {
  return {
    movementProposals: metrics.movementProposals,
    committedMoves: metrics.committedMoves,
    blockedMoves: metrics.blockedMoves,
    pathfindingExpansions: metrics.pathfindingExpansions,
    planningAttempts: metrics.planningAttempts,
    planningSuccesses: metrics.planningSuccesses,
    planningCandidateChecks: metrics.planningCandidateChecks,
    populationGrowthAttempts: metrics.populationGrowthAttempts,
    populationGrowthSuccesses: metrics.populationGrowthSuccesses,
  };
}

function createTickCursor(): StageCursor {
  return { workIndex: 0 };
}

function createTickCursors(): TickCursors {
  return {
    applyQueuedCommands: createTickCursor(),
    applyZoneRemovals: createTickCursor(),
    freezeCitizenOccupancy: createTickCursor(),
    decrementTimers: createTickCursor(),
    completeExpiredActivities: createTickCursor(),
    markCitizensRequiringGoal: createTickCursor(),
    fillConstructionAssignments: createTickCursor(),
    selectNonConstructionGoals: createTickCursor(),
    advancePathPlanning: createTickCursor(),
    accrueMovementCredit: createTickCursor(),
    generateMovementProposals: createTickCursor(),
    resolveMovementConflicts: createTickCursor(),
    commitAcceptedMovement: createTickCursor(),
    processArrivals: createTickCursor(),
    startBuildingActivities: createTickCursor(),
    produceWorkplaceData: createTickCursor(),
    applyConstructionLabor: createTickCursor(),
    completeBuildings: createTickCursor(),
    applyAssignmentChanges: createTickCursor(),
    evaluatePopulationGrowth: createTickCursor(),
    advanceBuildingPlanning: createTickCursor(),
    commitCompletedTick: createTickCursor(),
  };
}

function createPendingTick(
  state: AuthoritativeState,
  commands: readonly SimulationCommand[],
): PendingTick {
  return {
    nextState: {
      seed: state.seed,
      tick: state.tick + 1,
      data: state.data,
      homeStayTicks: state.homeStayTicks,
      workStayTicks: state.workStayTicks,
      citizens: state.citizens.map(copyCitizenForPending),
      zones: state.zones.map(copyZoneState),
      buildings: state.buildings.map(cloneBuildingInstance),
      nextZoneId: state.nextZoneId,
      nextBuildingId: state.nextBuildingId,
      nextCitizenId: state.nextCitizenId,
      world: cloneWorld(state.world),
      metrics: copyMetrics(state.metrics),
      planningChance: state.planningChance,
      constructionLaborRequirements: state.constructionLaborRequirements,
      lastPlanningJob: { ...state.lastPlanningJob },
      movementNoProgressTicks: state.movementNoProgressTicks,
      populationGrowthSequence: state.populationGrowthSequence,
      populationGrowthRollOverride: state.populationGrowthRollOverride,
    },
    cursors: createTickCursors(),
    commands: commands.map(copyPlaceZoneCommand),
    commandResults: [],
    nextStageIndex: 0,
    occupancy: null,
    pathSearches: new Map(),
    proposals: [],
    arrivedBuildingIds: new Map(),
    completedBuildingIds: new Set(),
    movementResolution: null,
    planningJob: null,
  };
}

function consumeSingleStage(cursor: StageCursor): boolean {
  if (cursor.workIndex !== 0) {
    throw new Error('A tick stage was processed more than once.');
  }
  cursor.workIndex = 1;
  return true;
}

function findBuildingById(
  state: AuthoritativeState,
  buildingId: BuildingId,
): BuildingInstance | undefined {
  return state.buildings.find((building) => building.id === buildingId);
}

function buildingContainsCell(building: BuildingInstance, position: GridPosition): boolean {
  const key = cellKey(position);
  return building.physicalCells.some((cell) => cellKey(cell) === key);
}

function isCitizenMovementCellWithinBounds(
  state: AuthoritativeState,
  citizen: CitizenState,
  position: GridPosition,
): boolean {
  if (citizen.activity !== null) {
    const building = findBuildingById(state, citizen.activity.buildingId);
    return building !== undefined && buildingContainsCell(building, position);
  }
  if (citizen.route !== null) return true;
  return isWithinWanderingBounds(citizen.wanderingAnchor, position);
}

function findBuildingContainingCell(
  state: AuthoritativeState,
  position: GridPosition,
): BuildingInstance | undefined {
  return state.buildings.find((building) => buildingContainsCell(building, position));
}

/** The next construction step can replace this with its project authorization rule. */
function isAuthorizedForIncompleteBuilding(
  citizen: CitizenState,
  building: BuildingInstance,
): boolean {
  return building.assignments.constructionWorkerIds.includes(citizen.id);
}

function clearBuildingRoute(citizen: CitizenState): void {
  citizen.route = null;
  citizen.path = null;
  citizen.pathIndex = 0;
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
}

function clearBuildingActivity(citizen: CitizenState): void {
  citizen.activity = null;
  citizen.internalTarget = null;
  citizen.internalPath = null;
  citizen.internalPathIndex = 0;
  citizen.internalPathNeedsReplan = false;
}

function clearInvalidBuildingDestinations(state: AuthoritativeState): void {
  for (const citizen of state.citizens) {
    if (citizen.route !== null) {
      const destinationId = citizen.route.destinationBuildingId;
      const destination =
        destinationId === null ? undefined : findBuildingById(state, destinationId);
      const destinationCell = citizen.route.destinationCell;
      const destinationIsValid =
        destination !== undefined &&
        destinationCell !== null &&
        buildingContainsCell(destination, destinationCell);
      const sourceIsValid =
        citizen.route.sourceBuildingId === null ||
        findBuildingById(state, citizen.route.sourceBuildingId) !== undefined;

      if (!destinationIsValid || !sourceIsValid) clearBuildingRoute(citizen);
    }

    if (citizen.activity !== null) {
      const activityBuilding = findBuildingById(state, citizen.activity.buildingId);
      if (
        activityBuilding === undefined ||
        !buildingContainsCell(activityBuilding, citizen.position)
      ) {
        clearBuildingActivity(citizen);
      }
    }
  }
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function replaceBuildingAssignments(
  building: BuildingInstance,
  overrides: Partial<BuildingInstance['assignments']>,
): BuildingInstance {
  return createBuildingInstance({
    id: building.id,
    zoneId: building.zoneId,
    archetype: building.archetypeId,
    origin: building.origin,
    transform: building.transform,
    state: building.state,
    assignments: {
      constructionWorkerIds:
        overrides.constructionWorkerIds ?? building.assignments.constructionWorkerIds,
      residentCitizenIds: overrides.residentCitizenIds ?? building.assignments.residentCitizenIds,
      workerCitizenIds: overrides.workerCitizenIds ?? building.assignments.workerCitizenIds,
      visitorReservationCitizenIds:
        overrides.visitorReservationCitizenIds ?? building.assignments.visitorReservationCitizenIds,
    },
  });
}

function replaceBuildingAsComplete(
  building: BuildingInstance,
  assignments: BuildingInstance['assignments'],
): BuildingInstance {
  return createBuildingInstance({
    id: building.id,
    zoneId: building.zoneId,
    archetype: building.archetypeId,
    origin: building.origin,
    transform: building.transform,
    state: { kind: 'complete' },
    assignments,
  });
}

type PersistentAssignmentField = 'residentCitizenIds' | 'workerCitizenIds';

function findCompletedBuilding(
  state: AuthoritativeState,
  buildingId: BuildingId | null,
  archetypeId: BuildingArchetypeId,
): BuildingInstance | undefined {
  if (buildingId === null) return undefined;
  const building = findBuildingById(state, buildingId);
  return building?.state.kind === 'complete' && building.archetypeId === archetypeId
    ? building
    : undefined;
}

function buildingDistance(left: BuildingInstance, right: BuildingInstance): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const leftCell of left.physicalCells) {
    for (const rightCell of right.physicalCells) {
      distance = Math.min(
        distance,
        Math.abs(leftCell.x - rightCell.x) + Math.abs(leftCell.y - rightCell.y),
      );
    }
  }
  if (!Number.isFinite(distance))
    throw new Error('Building physical footprints must not be empty.');
  return distance;
}

function replacePersistentAssignment(
  state: AuthoritativeState,
  buildingId: BuildingId,
  field: PersistentAssignmentField,
  citizenIds: readonly CitizenId[],
): void {
  const buildingIndex = state.buildings.findIndex((candidate) => candidate.id === buildingId);
  if (buildingIndex < 0) return;
  const building = state.buildings[buildingIndex];
  if (building === undefined) return;
  state.buildings[buildingIndex] = replaceBuildingAssignments(building, {
    [field]: citizenIds,
  });
}

function removePersistentAssignment(
  state: AuthoritativeState,
  buildingId: BuildingId,
  field: PersistentAssignmentField,
  citizenId: CitizenId,
): void {
  const building = findBuildingById(state, buildingId);
  if (building === undefined) return;
  const remaining = building.assignments[field].filter((candidate) => candidate !== citizenId);
  if (remaining.length === building.assignments[field].length) return;
  replacePersistentAssignment(state, buildingId, field, remaining);
}

function assignCitizenHome(
  state: AuthoritativeState,
  citizen: CitizenState,
  home: BuildingInstance,
): boolean {
  const homeIndex = state.buildings.findIndex((candidate) => candidate.id === home.id);
  const currentHome = state.buildings[homeIndex];
  if (
    homeIndex < 0 ||
    currentHome === undefined ||
    currentHome.state.kind !== 'complete' ||
    currentHome.archetypeId !== 'single-house'
  ) {
    throw new Error(`Home assignment requires a completed house; received ${home.id}.`);
  }
  if (citizen.homeBuildingId === home.id) return true;
  if (
    currentHome.assignments.residentCitizenIds.length >=
    getBuildingArchetype('single-house').capacities.residents
  ) {
    return false;
  }

  if (citizen.homeBuildingId !== null) {
    removePersistentAssignment(state, citizen.homeBuildingId, 'residentCitizenIds', citizen.id);
  }

  const updatedHome = state.buildings[homeIndex];
  if (updatedHome === undefined) throw new Error(`Home assignment lost building ${home.id}.`);
  state.buildings[homeIndex] = replaceBuildingAssignments(updatedHome, {
    residentCitizenIds: [...updatedHome.assignments.residentCitizenIds, citizen.id],
  });
  citizen.homeBuildingId = home.id;
  return true;
}

function assignCitizenWork(
  state: AuthoritativeState,
  citizen: CitizenState,
  workplace: BuildingInstance,
): boolean {
  const workplaceIndex = state.buildings.findIndex((candidate) => candidate.id === workplace.id);
  const currentWorkplace = state.buildings[workplaceIndex];
  if (
    workplaceIndex < 0 ||
    currentWorkplace === undefined ||
    currentWorkplace.state.kind !== 'complete' ||
    currentWorkplace.archetypeId !== 'small-shop'
  ) {
    throw new Error(`Work assignment requires a completed shop; received ${workplace.id}.`);
  }
  if (citizen.workBuildingId === workplace.id) return true;
  if (
    currentWorkplace.assignments.workerCitizenIds.length >=
    getBuildingArchetype('small-shop').capacities.workers
  ) {
    return false;
  }

  if (citizen.workBuildingId !== null) {
    removePersistentAssignment(state, citizen.workBuildingId, 'workerCitizenIds', citizen.id);
  }

  const updatedWorkplace = state.buildings[workplaceIndex];
  if (updatedWorkplace === undefined) {
    throw new Error(`Work assignment lost building ${workplace.id}.`);
  }
  state.buildings[workplaceIndex] = replaceBuildingAssignments(updatedWorkplace, {
    workerCitizenIds: [...updatedWorkplace.assignments.workerCitizenIds, citizen.id],
  });
  citizen.workBuildingId = workplace.id;
  return true;
}

function calculateCompletedHomeCapacity(state: AuthoritativeState): number {
  return state.buildings.reduce((capacity, building) => {
    if (building.state.kind !== 'complete') return capacity;
    return capacity + getBuildingArchetype(building.archetypeId).capacities.residents;
  }, 0);
}

interface PopulationGrowthHomeCandidate {
  readonly building: BuildingInstance;
  readonly vacantResidentSlots: number;
}

interface PopulationGrowthSpawn {
  readonly home: BuildingInstance;
  readonly position: GridPosition;
}

function compareGridPositions(left: GridPosition, right: GridPosition): number {
  return left.y - right.y || left.x - right.x;
}

function selectPopulationGrowthSpawnCell(options: {
  readonly state: AuthoritativeState;
  readonly home: BuildingInstance;
  readonly population: number;
  readonly completedHomeCapacity: number;
  readonly populationGrowthSequence: number;
}): GridPosition | null {
  const occupiedCells = new Set(options.state.citizens.map((citizen) => cellKey(citizen.position)));
  const cells = [...options.home.physicalCells].map(copyPosition).sort(compareGridPositions);
  if (cells.length === 0) return null;

  const firstIndex = Math.floor(
    keyedPlanningUnit({
      seed: options.state.seed,
      tick: options.state.tick,
      population: options.population,
      completedHomeCapacity: options.completedHomeCapacity,
      populationGrowthSequence: options.populationGrowthSequence,
      homeBuildingId: options.home.id,
      purpose: 'population-growth-spawn-cell',
    }) * cells.length,
  );

  for (let offset = 0; offset < cells.length; offset += 1) {
    const index = (firstIndex + offset) % cells.length;
    const cell = cells[index];
    if (cell !== undefined && !occupiedCells.has(cellKey(cell))) return cell;
  }
  return null;
}

function selectPopulationGrowthHome(options: {
  readonly state: AuthoritativeState;
  readonly population: number;
  readonly completedHomeCapacity: number;
  readonly populationGrowthSequence: number;
}): PopulationGrowthSpawn | null {
  const homeCapacity = getBuildingArchetype('single-house').capacities.residents;
  const candidates = options.state.buildings
    .filter(
      (building) => building.state.kind === 'complete' && building.archetypeId === 'single-house',
    )
    .map((building): PopulationGrowthHomeCandidate => ({
      building,
      vacantResidentSlots: homeCapacity - building.assignments.residentCitizenIds.length,
    }))
    .filter((candidate) => candidate.vacantResidentSlots > 0)
    .sort((left, right) => compareStableIds(left.building.id, right.building.id));

  if (candidates.length === 0) return null;

  const totalVacantSlots = candidates.reduce(
    (total, candidate) => total + candidate.vacantResidentSlots,
    0,
  );
  const weightedSlot = Math.floor(
    keyedPlanningUnit({
      seed: options.state.seed,
      tick: options.state.tick,
      population: options.population,
      completedHomeCapacity: options.completedHomeCapacity,
      populationGrowthSequence: options.populationGrowthSequence,
      purpose: 'population-growth-home-selection',
    }) * totalVacantSlots,
  );
  let selectedIndex = 0;
  let slotStart = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const slotEnd = slotStart + candidate.vacantResidentSlots;
    if (weightedSlot < slotEnd) {
      selectedIndex = index;
      break;
    }
    slotStart = slotEnd;
  }

  const orderedCandidates = [
    candidates[selectedIndex],
    ...candidates.filter((_candidate, index) => index !== selectedIndex),
  ];
  for (const candidate of orderedCandidates) {
    if (candidate === undefined) continue;
    const position = selectPopulationGrowthSpawnCell({
      state: options.state,
      home: candidate.building,
      population: options.population,
      completedHomeCapacity: options.completedHomeCapacity,
      populationGrowthSequence: options.populationGrowthSequence,
    });
    if (position !== null) return { home: candidate.building, position };
  }
  return null;
}

function assignCitizenToAvailableWorkplace(state: AuthoritativeState, citizen: CitizenState): void {
  const home = findCompletedBuilding(state, citizen.homeBuildingId, 'single-house');
  const workCapacity = getBuildingArchetype('small-shop').capacities.workers;
  const workplaces = state.buildings
    .filter(
      (building) =>
        building.state.kind === 'complete' &&
        building.archetypeId === 'small-shop' &&
        building.assignments.workerCitizenIds.length < workCapacity,
    )
    .sort(
      (left, right) =>
        (home === undefined ? 0 : buildingDistance(home, left)) -
          (home === undefined ? 0 : buildingDistance(home, right)) ||
        compareStableIds(left.id, right.id),
    );

  for (const workplace of workplaces) {
    if (assignCitizenWork(state, citizen, workplace)) return;
  }
}

function processPopulationGrowth(state: AuthoritativeState): void {
  const population = state.citizens.length;
  const completedHomeCapacity = calculateCompletedHomeCapacity(state);
  if (completedHomeCapacity <= population) return;

  const populationGrowthSequence = state.populationGrowthSequence + 1;
  state.populationGrowthSequence = populationGrowthSequence;
  state.metrics.populationGrowthAttempts += 1;

  const chance = calculatePopulationGrowthChance(completedHomeCapacity, population);
  const roll =
    state.populationGrowthRollOverride ??
    keyedPlanningUnit({
      seed: state.seed,
      tick: state.tick,
      population,
      completedHomeCapacity,
      populationGrowthSequence,
      purpose: 'population-growth-roll',
    });
  if (roll >= chance) return;

  const selection = selectPopulationGrowthHome({
    state,
    population,
    completedHomeCapacity,
    populationGrowthSequence,
  });
  if (selection === null) return;

  const citizenId = createCitizenId(`citizen-${String(state.nextCitizenId)}`);
  const citizen = createCitizenState(citizenId, selection.position);
  if (!assignCitizenHome(state, citizen, selection.home)) return;

  state.nextCitizenId += 1;
  state.citizens.push(citizen);
  ensureChunkAt(state.world, citizen.position);
  assignCitizenToAvailableWorkplace(state, citizen);
  state.metrics.populationGrowthSuccesses += 1;
}

interface BuildingDistanceCandidate {
  readonly building: BuildingInstance;
  readonly distance: number;
}

function closestCompletedBuildings(
  state: AuthoritativeState,
  reference: BuildingInstance,
  archetypeId: BuildingArchetypeId,
): readonly BuildingInstance[] {
  return state.buildings
    .filter(
      (building) => building.state.kind === 'complete' && building.archetypeId === archetypeId,
    )
    .map((building): BuildingDistanceCandidate => ({
      building,
      distance: buildingDistance(reference, building),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance || compareStableIds(left.building.id, right.building.id),
    )
    .slice(0, 10)
    .map((candidate) => candidate.building);
}

function applyHomeCompletionAssignments(
  state: AuthoritativeState,
  completedHome: BuildingInstance,
): void {
  const homeCapacity = getBuildingArchetype('single-house').capacities.residents;
  const homelessCandidates = state.citizens
    .filter((citizen) => citizen.homeBuildingId === null)
    .map((citizen) => {
      const workplace = findCompletedBuilding(state, citizen.workBuildingId, 'small-shop');
      return {
        citizen,
        hasWork: citizen.workBuildingId !== null,
        commuteDistance: workplace === undefined ? 0 : buildingDistance(completedHome, workplace),
      };
    })
    .sort((left, right) => {
      if (left.hasWork !== right.hasWork) return left.hasWork ? -1 : 1;
      if (left.hasWork && right.hasWork && left.commuteDistance !== right.commuteDistance) {
        return left.commuteDistance - right.commuteDistance;
      }
      return compareStableIds(left.citizen.id, right.citizen.id);
    });

  for (const candidate of homelessCandidates) {
    const currentHome = findBuildingById(state, completedHome.id);
    if (
      currentHome === undefined ||
      currentHome.assignments.residentCitizenIds.length >= homeCapacity
    ) {
      break;
    }
    assignCitizenHome(state, candidate.citizen, currentHome);
  }

  const currentHome = findBuildingById(state, completedHome.id);
  if (currentHome === undefined || currentHome.state.kind !== 'complete') return;
  const workplaceIds = new Set(
    closestCompletedBuildings(state, currentHome, 'small-shop').map((building) => building.id),
  );
  const reassignments = state.citizens
    .filter(
      (citizen) => citizen.workBuildingId !== null && workplaceIds.has(citizen.workBuildingId),
    )
    .map((citizen) => {
      const oldHome = findCompletedBuilding(state, citizen.homeBuildingId, 'single-house');
      const workplace = findCompletedBuilding(state, citizen.workBuildingId, 'small-shop');
      if (oldHome === undefined || workplace === undefined) return null;
      const oldDistance = buildingDistance(oldHome, workplace);
      const newDistance = buildingDistance(currentHome, workplace);
      if (newDistance >= oldDistance) return null;
      return {
        citizen,
        oldDistance,
        reduction: oldDistance - newDistance,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        readonly citizen: CitizenState;
        readonly oldDistance: number;
        readonly reduction: number;
      } => candidate !== null,
    )
    .sort(
      (left, right) =>
        right.reduction - left.reduction ||
        right.oldDistance - left.oldDistance ||
        compareStableIds(left.citizen.id, right.citizen.id),
    );

  for (const candidate of reassignments) {
    const availableHome = findBuildingById(state, completedHome.id);
    if (
      availableHome === undefined ||
      availableHome.assignments.residentCitizenIds.length >= homeCapacity
    ) {
      break;
    }
    assignCitizenHome(state, candidate.citizen, availableHome);
  }
}

function applyWorkCompletionAssignments(
  state: AuthoritativeState,
  completedWorkplace: BuildingInstance,
): void {
  const workCapacity = getBuildingArchetype('small-shop').capacities.workers;
  const unemployedCandidates = state.citizens
    .filter((citizen) => citizen.workBuildingId === null)
    .map((citizen) => {
      const home = findCompletedBuilding(state, citizen.homeBuildingId, 'single-house');
      return {
        citizen,
        hasHome: citizen.homeBuildingId !== null,
        commuteDistance: home === undefined ? 0 : buildingDistance(home, completedWorkplace),
      };
    })
    .sort((left, right) => {
      if (left.hasHome !== right.hasHome) return left.hasHome ? -1 : 1;
      if (left.hasHome && right.hasHome && left.commuteDistance !== right.commuteDistance) {
        return left.commuteDistance - right.commuteDistance;
      }
      return compareStableIds(left.citizen.id, right.citizen.id);
    });

  for (const candidate of unemployedCandidates) {
    const currentWorkplace = findBuildingById(state, completedWorkplace.id);
    if (
      currentWorkplace === undefined ||
      currentWorkplace.assignments.workerCitizenIds.length >= workCapacity
    ) {
      break;
    }
    assignCitizenWork(state, candidate.citizen, currentWorkplace);
  }

  const currentWorkplace = findBuildingById(state, completedWorkplace.id);
  if (currentWorkplace === undefined || currentWorkplace.state.kind !== 'complete') return;
  const homeIds = new Set(
    closestCompletedBuildings(state, currentWorkplace, 'single-house').map(
      (building) => building.id,
    ),
  );
  const reassignments = state.citizens
    .filter((citizen) => citizen.homeBuildingId !== null && homeIds.has(citizen.homeBuildingId))
    .map((citizen) => {
      const home = findCompletedBuilding(state, citizen.homeBuildingId, 'single-house');
      const oldWorkplace = findCompletedBuilding(state, citizen.workBuildingId, 'small-shop');
      if (home === undefined || oldWorkplace === undefined) return null;
      const oldDistance = buildingDistance(home, oldWorkplace);
      const newDistance = buildingDistance(home, currentWorkplace);
      if (newDistance >= oldDistance) return null;
      return {
        citizen,
        oldDistance,
        reduction: oldDistance - newDistance,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        readonly citizen: CitizenState;
        readonly oldDistance: number;
        readonly reduction: number;
      } => candidate !== null,
    )
    .sort(
      (left, right) =>
        right.reduction - left.reduction ||
        right.oldDistance - left.oldDistance ||
        compareStableIds(left.citizen.id, right.citizen.id),
    );

  for (const candidate of reassignments) {
    const availableWorkplace = findBuildingById(state, completedWorkplace.id);
    if (
      availableWorkplace === undefined ||
      availableWorkplace.assignments.workerCitizenIds.length >= workCapacity
    ) {
      break;
    }
    assignCitizenWork(state, candidate.citizen, availableWorkplace);
  }
}

function clearConstructionState(citizen: CitizenState, buildingId: BuildingId): void {
  if (citizen.constructionBuildingId === buildingId) citizen.constructionBuildingId = null;
  if (citizen.route?.destinationBuildingId === buildingId) clearBuildingRoute(citizen);
  if (citizen.activity?.buildingId === buildingId && citizen.activity.kind === 'construction') {
    clearBuildingActivity(citizen);
  }
}

/** Keeps the temporary per-citizen and per-project assignment views consistent. */
function clearInvalidConstructionAssignments(state: AuthoritativeState): void {
  const citizensById = new Map<CitizenId, CitizenState>();
  for (const citizen of state.citizens) citizensById.set(citizen.id, citizen);

  for (let index = 0; index < state.buildings.length; index += 1) {
    const building = state.buildings[index];
    if (building === undefined || building.state.kind !== 'incomplete') continue;

    const validWorkerIds = building.assignments.constructionWorkerIds.filter((citizenId) => {
      const citizen = citizensById.get(citizenId);
      return citizen?.constructionBuildingId === building.id;
    });
    if (validWorkerIds.length !== building.assignments.constructionWorkerIds.length) {
      state.buildings[index] = replaceBuildingAssignments(building, {
        constructionWorkerIds: validWorkerIds,
      });
    }
  }

  for (const citizen of state.citizens) {
    const buildingId = citizen.constructionBuildingId;
    if (buildingId === null) continue;
    const building = findBuildingById(state, buildingId);
    if (
      building === undefined ||
      building.state.kind !== 'incomplete' ||
      !building.assignments.constructionWorkerIds.includes(citizen.id)
    ) {
      clearConstructionState(citizen, buildingId);
    }
  }
}

function selectNextInternalActivityTarget(
  state: AuthoritativeState,
  citizen: CitizenState,
): boolean {
  const activity = citizen.activity;
  if (activity === null) return false;
  const building = findBuildingById(state, activity.buildingId);
  if (building === undefined || !buildingContainsCell(building, citizen.position)) {
    clearBuildingActivity(citizen);
    return false;
  }

  activity.internalWanderingSequence += 1;
  citizen.internalTarget = selectInternalBuildingDestinationCell({
    worldSeed: state.seed,
    citizenId: citizen.id,
    buildingId: building.id,
    tripSequence: activity.internalWanderingSequence,
    physicalCells: building.physicalCells,
  });
  citizen.internalPath = null;
  citizen.internalPathIndex = 0;
  citizen.internalPathNeedsReplan = false;
  return true;
}

function startStayActivity(
  state: AuthoritativeState,
  citizen: CitizenState,
  buildingId: BuildingId,
  purpose: 'home' | 'work',
): void {
  const building = findBuildingById(state, buildingId);
  if (
    building === undefined ||
    building.state.kind !== 'complete' ||
    !buildingContainsCell(building, citizen.position)
  ) {
    clearBuildingRoute(citizen);
    return;
  }

  citizen.activity = {
    buildingId,
    kind: purpose === 'home' ? 'home-stay' : 'work-stay',
    ticksRemaining: purpose === 'home' ? state.homeStayTicks : state.workStayTicks,
    internalWanderingSequence: 0,
  };
  citizen.route = null;
  citizen.path = null;
  citizen.pathIndex = 0;
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
  citizen.internalTarget = null;
  citizen.internalPath = null;
  citizen.internalPathIndex = 0;
  citizen.internalPathNeedsReplan = false;
}

function startConstructionBuildingActivity(
  state: AuthoritativeState,
  citizen: CitizenState,
  buildingId: BuildingId,
): void {
  const building = findBuildingById(state, buildingId);
  if (
    building === undefined ||
    building.state.kind !== 'incomplete' ||
    citizen.constructionBuildingId !== building.id ||
    !buildingContainsCell(building, citizen.position)
  ) {
    clearBuildingRoute(citizen);
    return;
  }

  citizen.activity = {
    buildingId,
    kind: 'construction',
    ticksRemaining: 0,
    internalWanderingSequence: 0,
  };
  citizen.route = null;
  citizen.path = null;
  citizen.pathIndex = 0;
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
  citizen.internalTarget = null;
  citizen.internalPath = null;
  citizen.internalPathIndex = 0;
  citizen.internalPathNeedsReplan = false;
}

function startWanderingSegment(state: AuthoritativeState, citizen: CitizenState): void {
  citizen.wanderingSequence += 1;
  citizen.wanderingAnchor = copyPosition(citizen.position);
  citizen.wanderingTarget = selectWanderTarget(
    state.seed,
    citizen.id,
    citizen.wanderingSequence,
    citizen.wanderingAnchor,
  );
  citizen.path = null;
  citizen.pathIndex = 0;
  citizen.goalStartTick = state.tick;
  clearBuildingRoute(citizen);
  ensureChunkAt(state.world, citizen.wanderingAnchor);
  ensureChunkAt(state.world, citizen.wanderingTarget);
}

function manhattanDistanceToFootprint(
  position: GridPosition,
  physicalCells: readonly GridPosition[],
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const cell of physicalCells) {
    distance = Math.min(distance, Math.abs(position.x - cell.x) + Math.abs(position.y - cell.y));
  }
  return distance;
}

function selectConstructionDestinationCell(
  state: AuthoritativeState,
  citizen: CitizenState,
  building: BuildingInstance,
  tripSequence: number,
): GridPosition {
  return selectBuildingDestinationCell({
    worldSeed: state.seed,
    citizenId: citizen.id,
    buildingId: building.id,
    tripSequence,
    purpose: 'construction-destination',
    physicalCells: building.physicalCells,
  });
}

function canReachConstructionProject(
  state: AuthoritativeState,
  citizen: CitizenState,
  building: BuildingInstance,
): boolean {
  const tripSequence = citizen.tripSequence + 1;
  const destinationCell = selectConstructionDestinationCell(state, citizen, building, tripSequence);
  const sourceBuilding = findBuildingContainingCell(state, citizen.position);
  const passability = createBuildingPassabilityCallback({
    buildings: state.buildings,
    sourceBuildingId: sourceBuilding?.id ?? null,
    destinationBuildingId: building.id,
    isAuthorizedForIncompleteBuilding: (candidate) => candidate.id === building.id,
  });
  const search = createAStarSearch({
    start: citizen.position,
    goal: destinationCell,
    isWalkable: passability,
  });
  return search.advance(Number.MAX_SAFE_INTEGER).status === 'found';
}

function isCitizenAvailableForConstruction(citizen: CitizenState): boolean {
  if (citizen.constructionBuildingId !== null) return false;
  if (citizen.activity !== null || citizen.route !== null || citizen.routeNeedsReplan) return false;
  return citizen.path === null || citizen.pathIndex >= citizen.path.length;
}

function startConstructionTrip(
  state: AuthoritativeState,
  citizen: CitizenState,
  building: BuildingInstance,
): void {
  const tripSequence = citizen.tripSequence + 1;
  citizen.tripSequence = tripSequence;
  const sourceBuilding = findBuildingContainingCell(state, citizen.position);
  citizen.route = {
    purpose: 'construction',
    sourceBuildingId: sourceBuilding?.id ?? null,
    destinationBuildingId: building.id,
    destinationCell: selectConstructionDestinationCell(state, citizen, building, tripSequence),
    tripSequence,
  };
  citizen.path = null;
  citizen.pathIndex = 0;
  citizen.goalStartTick = state.tick;
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
}

function startBuildingTrip(
  state: AuthoritativeState,
  citizen: CitizenState,
  building: BuildingInstance,
  purpose: 'home' | 'work',
): void {
  if (building.state.kind !== 'complete') {
    throw new Error(`Citizen trips may only target completed buildings; received ${building.id}.`);
  }

  const tripSequence = citizen.tripSequence + 1;
  citizen.tripSequence = tripSequence;
  const sourceBuilding = findBuildingContainingCell(state, citizen.position);
  citizen.route = {
    purpose,
    sourceBuildingId: sourceBuilding?.id ?? null,
    destinationBuildingId: building.id,
    destinationCell: selectBuildingDestinationCell({
      worldSeed: state.seed,
      citizenId: citizen.id,
      buildingId: building.id,
      tripSequence,
      purpose: `${purpose}-destination`,
      physicalCells: building.physicalCells,
    }),
    tripSequence,
  };
  citizen.path = null;
  citizen.pathIndex = 0;
  citizen.goalStartTick = state.tick;
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
}

function countConstructionAssignedCitizens(state: AuthoritativeState): number {
  return state.citizens.reduce(
    (count, citizen) => count + (citizen.constructionBuildingId === null ? 0 : 1),
    0,
  );
}

interface ConstructionCandidate {
  readonly citizen: CitizenState;
  readonly preferred: boolean;
  readonly distance: number;
}

function selectConstructionCandidate(
  state: AuthoritativeState,
  building: BuildingInstance,
): CitizenState | null {
  const constructionAssignedCount = countConstructionAssignedCitizens(state);
  const fullyAssignedCitizensProtected =
    state.citizens.length > 0 && constructionAssignedCount * 2 >= state.citizens.length;
  const candidates: ConstructionCandidate[] = [];

  for (const citizen of state.citizens) {
    if (!isCitizenAvailableForConstruction(citizen)) continue;
    const preferred = citizen.homeBuildingId === null || citizen.workBuildingId === null;
    if (!preferred && fullyAssignedCitizensProtected) continue;
    if (!canReachConstructionProject(state, citizen, building)) continue;
    candidates.push({
      citizen,
      preferred,
      distance: manhattanDistanceToFootprint(citizen.position, building.physicalCells),
    });
  }

  if (candidates.length === 0) return null;
  const preferredCandidates = candidates.filter((candidate) => candidate.preferred);
  const ranked = (preferredCandidates.length > 0 ? preferredCandidates : candidates).sort(
    (left, right) =>
      right.preferred === left.preferred
        ? left.distance - right.distance || compareStableIds(left.citizen.id, right.citizen.id)
        : left.preferred
          ? -1
          : 1,
  );
  return ranked[0]?.citizen ?? null;
}

function assignConstructionWorker(
  state: AuthoritativeState,
  citizen: CitizenState,
  building: BuildingInstance,
): void {
  if (citizen.constructionBuildingId !== null) {
    throw new Error(`Citizen ${citizen.id} already has a construction assignment.`);
  }
  const buildingIndex = state.buildings.findIndex((candidate) => candidate.id === building.id);
  if (buildingIndex < 0) throw new Error(`Unknown construction project ${building.id}.`);
  const currentBuilding = state.buildings[buildingIndex];
  if (currentBuilding === undefined || currentBuilding.state.kind !== 'incomplete') {
    throw new Error(`Construction project ${building.id} is not incomplete.`);
  }
  const capacity = getBuildingArchetype(currentBuilding.archetypeId).capacities.constructionWorkers;
  if (currentBuilding.assignments.constructionWorkerIds.length >= capacity) {
    throw new Error(`Construction project ${building.id} has no open worker slot.`);
  }

  state.buildings[buildingIndex] = replaceBuildingAssignments(currentBuilding, {
    constructionWorkerIds: [...currentBuilding.assignments.constructionWorkerIds, citizen.id],
  });
  citizen.constructionBuildingId = currentBuilding.id;
  citizen.path = null;
  citizen.pathIndex = 0;
  citizen.route = null;
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
}

function processFillConstructionAssignments(pending: PendingTick): boolean {
  const cursor = pending.cursors.fillConstructionAssignments;
  consumeSingleStage(cursor);
  const state = pending.nextState;
  clearInvalidConstructionAssignments(state);

  const projects = state.buildings
    .filter((building) => building.state.kind === 'incomplete')
    .sort((left, right) => compareStableIds(left.id, right.id));
  for (const project of projects) {
    const capacity = getBuildingArchetype(project.archetypeId).capacities.constructionWorkers;
    while (true) {
      const currentProject = findBuildingById(state, project.id);
      if (currentProject === undefined || currentProject.state.kind !== 'incomplete') break;
      if (currentProject.assignments.constructionWorkerIds.length >= capacity) break;
      const candidate = selectConstructionCandidate(state, currentProject);
      if (candidate === null) break;
      assignConstructionWorker(state, candidate, currentProject);
    }
  }
  return true;
}

const PLANNING_ARCHETYPE_BY_ZONE_TYPE: Readonly<Record<ZoneType, BuildingArchetypeId>> =
  Object.freeze({
    living: 'single-house',
    working: 'small-shop',
    leisure: 'small-park',
  });

function isPlanningEligible(state: AuthoritativeState): boolean {
  const population = state.citizens.length;
  if (population === 0) return true;
  return countConstructionAssignedCitizens(state) * 4 < population;
}

function selectPlanningZone(options: {
  readonly seed: number;
  readonly tick: number;
  readonly successes: readonly {
    readonly zone: ZoneState;
    readonly freeSpaceRatio: number;
  }[];
}): { readonly zone: ZoneState; readonly freeSpaceRatio: number } | null {
  if (options.successes.length === 0) return null;

  const ranked = options.successes.map((success) => {
    const unit = keyedPlanningUnit({
      seed: options.seed,
      tick: options.tick,
      zoneId: success.zone.id,
      planningSequence: success.zone.planningSequence,
      purpose: 'building-planning-zone-selection',
    });
    return {
      ...success,
      priority: Math.log(unit) / success.freeSpaceRatio,
    };
  });

  ranked.sort(
    (left, right) =>
      right.priority - left.priority || comparePlanningZoneIds(left.zone.id, right.zone.id),
  );
  const selected = ranked[0];
  return selected === undefined
    ? null
    : { zone: selected.zone, freeSpaceRatio: selected.freeSpaceRatio };
}

function beginPlanningOpportunity(pending: PendingTick): void {
  if (pending.planningJob !== null) return;

  const state = pending.nextState;
  if (!isPlanningEligible(state)) return;

  const existingBuildings = state.buildings;
  const orderedZones = [...state.zones].sort((left, right) =>
    comparePlanningZoneIds(left.id, right.id),
  );
  const successes: { readonly zone: ZoneState; readonly freeSpaceRatio: number }[] = [];

  for (const zone of orderedZones) {
    if (zone.planningSaturated) continue;

    const freeSpaceRatio = calculateZoneFreeSpaceRatio(zone, existingBuildings);
    const planningSequence = zone.planningSequence + 1;
    const chance = calculatePlanningChance(freeSpaceRatio, state.planningChance);
    const succeeds = planningRollSucceeds({
      seed: state.seed,
      tick: state.tick,
      zoneId: zone.id,
      planningSequence,
      chance,
    });

    zone.planningSequence = planningSequence;
    zone.immediatePlanningPending = false;
    state.metrics.planningAttempts += 1;
    if (succeeds) successes.push({ zone, freeSpaceRatio });
  }

  const selected = selectPlanningZone({
    seed: state.seed,
    tick: state.tick,
    successes,
  });
  if (selected === null) return;

  const archetypeId = PLANNING_ARCHETYPE_BY_ZONE_TYPE[selected.zone.type];
  const archetype = getBuildingArchetype(archetypeId);
  const planningSequence = selected.zone.planningSequence;
  pending.planningJob = {
    zoneId: selected.zone.id,
    archetypeId,
    archetypeOrder: Object.freeze([archetypeId]),
    transformOrder: orderPlanningTransforms({
      seed: state.seed,
      zoneId: selected.zone.id,
      planningSequence,
      archetype,
    }),
    anchorOrder: orderPlanningAnchors({
      seed: state.seed,
      zoneId: selected.zone.id,
      planningSequence,
      archetypeId,
      rect: selected.zone.rect,
    }),
    planningSequence,
    candidateCursor: 0,
    validCandidatesFound: 0,
    workConsumed: 0,
    selectedCandidate: null,
  };
}

function invalidateRoutesCrossingFootprint(
  state: AuthoritativeState,
  physicalCells: readonly GridPosition[],
): void {
  const physicalCellKeys = new Set(physicalCells.map(cellKey));
  for (const citizen of state.citizens) {
    if (citizen.path === null) continue;
    if (
      !citizen.path.some(
        (position, index) => index >= citizen.pathIndex && physicalCellKeys.has(cellKey(position)),
      )
    ) {
      continue;
    }
    citizen.path = null;
    citizen.pathIndex = 0;
    citizen.routeNeedsReplan = true;
    citizen.replanWithOccupancy = false;
  }
}

function acceptPlanningCandidate(
  pending: PendingTick,
  job: BuildingPlanningJob,
  zone: ZoneState,
  candidate: SelectedPlanningCandidate,
): void {
  const state = pending.nextState;
  const archetype = getBuildingArchetype(job.archetypeId);
  const building = createBuildingInstance({
    id: createBuildingId(`building-${String(state.nextBuildingId)}`),
    zoneId: zone.id,
    archetype,
    origin: candidate.origin,
    transform: candidate.transform,
    state: {
      kind: 'incomplete',
      laborCompleted: 0,
      laborRequired: state.constructionLaborRequirements[archetype.id] ?? archetype.labor,
    },
  });

  state.buildings.push(building);
  state.nextBuildingId += 1;
  state.metrics.planningSuccesses += 1;
  invalidateRoutesCrossingFootprint(state, candidate.geometry.physicalCells);
  state.lastPlanningJob = {
    status: 'accepted',
    zoneId: zone.id,
    archetypeId: job.archetypeId,
    planningSequence: job.planningSequence,
    candidateChecks: job.candidateCursor,
  };
}

function markPlanningSaturated(
  pending: PendingTick,
  job: BuildingPlanningJob,
  zone: ZoneState,
): void {
  zone.planningSaturated = true;
  pending.nextState.lastPlanningJob = {
    status: 'saturated',
    zoneId: zone.id,
    archetypeId: job.archetypeId,
    planningSequence: job.planningSequence,
    candidateChecks: job.candidateCursor,
  };
}

function processAdvanceBuildingPlanning(pending: PendingTick): boolean {
  const cursor = pending.cursors.advanceBuildingPlanning;
  if (pending.planningJob === null) beginPlanningOpportunity(pending);

  const job = pending.planningJob;
  if (job === null) {
    cursor.workIndex = 1;
    return true;
  }

  const zone = pending.nextState.zones.find((candidate) => candidate.id === job.zoneId);
  if (zone === undefined) throw new Error(`Planning job references unknown zone ${job.zoneId}.`);
  const archetypeId = job.archetypeOrder[0];
  if (archetypeId === undefined || archetypeId !== job.archetypeId) {
    throw new Error(`Planning job ${job.zoneId} has an invalid archetype order.`);
  }
  const archetype = getBuildingArchetype(archetypeId);
  const totalCandidates = job.transformOrder.length * job.anchorOrder.length;

  if (job.candidateCursor >= totalCandidates) {
    markPlanningSaturated(pending, job, zone);
    pending.planningJob = null;
    cursor.workIndex = 1;
    return true;
  }

  const anchorCount = job.anchorOrder.length;
  if (anchorCount === 0) throw new Error(`Planning job ${job.zoneId} has no candidate anchors.`);
  const transformIndex = Math.floor(job.candidateCursor / anchorCount);
  const anchorIndex = job.candidateCursor % anchorCount;
  const transform = job.transformOrder[transformIndex];
  const origin = job.anchorOrder[anchorIndex];
  if (transform === undefined || origin === undefined) {
    throw new Error(`Planning job ${job.zoneId} candidate cursor exceeded its order.`);
  }

  const validation = validatePlanningCandidate({
    archetype,
    zone,
    origin,
    transform,
    existingBuildings: pending.nextState.buildings,
    citizens: pending.nextState.citizens,
  });
  job.candidateCursor += 1;
  job.workConsumed += 1;
  job.validCandidatesFound += validation === null ? 0 : 1;
  pending.nextState.metrics.planningCandidateChecks += 1;

  if (validation !== null) {
    job.selectedCandidate = {
      origin: validation.origin,
      transform: validation.transform,
      geometry: validation.geometry,
    };
    acceptPlanningCandidate(pending, job, zone, job.selectedCandidate);
    pending.planningJob = null;
    cursor.workIndex = 1;
    return true;
  }

  if (job.candidateCursor >= totalCandidates) {
    markPlanningSaturated(pending, job, zone);
    pending.planningJob = null;
    cursor.workIndex = 1;
    return true;
  }

  return false;
}

function isStaticCellWalkable(
  state: AuthoritativeState,
  citizen: CitizenState,
  position: GridPosition,
): boolean {
  const positionKeyValue = cellKey(position);
  if (citizen.activity !== null) {
    const activityBuilding = findBuildingById(state, citizen.activity.buildingId);
    return (
      activityBuilding !== undefined &&
      buildingContainsCell(activityBuilding, position) &&
      (activityBuilding.state.kind === 'complete' ||
        isAuthorizedForIncompleteBuilding(citizen, activityBuilding))
    );
  }

  const building = findBuildingContainingCell(state, position);
  if (positionKeyValue === cellKey(citizen.position)) {
    if (building === undefined) return true;
    const route = citizen.route;
    return isBuildingPassable(building, {
      sourceBuildingId: route?.sourceBuildingId ?? null,
      destinationBuildingId: route?.destinationBuildingId ?? null,
      isAuthorizedForIncompleteBuilding: (candidate) =>
        isAuthorizedForIncompleteBuilding(citizen, candidate),
    });
  }
  if (building === undefined) return true;

  const route = citizen.route;
  return isBuildingPassable(building, {
    sourceBuildingId: route?.sourceBuildingId ?? null,
    destinationBuildingId: route?.destinationBuildingId ?? null,
    isAuthorizedForIncompleteBuilding: (candidate) =>
      isAuthorizedForIncompleteBuilding(citizen, candidate),
  });
}

function processFreezeCitizenOccupancy(pending: PendingTick): boolean {
  const cursor = pending.cursors.freezeCitizenOccupancy;
  consumeSingleStage(cursor);
  clearInvalidBuildingDestinations(pending.nextState);

  const occupancy = new Map<string, CitizenId>();
  for (const citizen of pending.nextState.citizens) {
    const key = cellKey(citizen.position);
    if (occupancy.has(key)) {
      throw new Error(`Citizens overlap at ${key} before movement resolution.`);
    }
    occupancy.set(key, citizen.id);

    if (citizen.blockedMovementCount >= 8) {
      if (citizen.activity !== null && !citizen.internalPathNeedsReplan) {
        citizen.internalPathNeedsReplan = true;
        citizen.replanWithOccupancy = true;
        citizen.internalPath = null;
        citizen.internalPathIndex = 0;
      } else if (citizen.activity === null && !citizen.routeNeedsReplan) {
        citizen.routeNeedsReplan = true;
        citizen.replanWithOccupancy = true;
        citizen.path = null;
        citizen.pathIndex = 0;
      }
    }
  }
  pending.occupancy = occupancy;
  return true;
}

function startHomeWorkTrip(state: AuthoritativeState, citizen: CitizenState): void {
  const home = findCompletedBuilding(state, citizen.homeBuildingId, 'single-house');
  const workplace = findCompletedBuilding(state, citizen.workBuildingId, 'small-shop');
  if (home === undefined || workplace === undefined) {
    startWanderingSegment(state, citizen);
    return;
  }

  const currentBuilding = findBuildingContainingCell(state, citizen.position);
  if (currentBuilding?.id === home.id) {
    startBuildingTrip(state, citizen, workplace, 'work');
  } else {
    startBuildingTrip(state, citizen, home, 'home');
  }
}

function processSelectNonConstructionGoals(pending: PendingTick): boolean {
  const cursor = pending.cursors.selectNonConstructionGoals;
  consumeSingleStage(cursor);

  for (const citizen of pending.nextState.citizens) {
    if (citizen.activity !== null) continue;

    const constructionBuildingId = citizen.constructionBuildingId;
    if (constructionBuildingId !== null) {
      const constructionBuilding = findBuildingById(pending.nextState, constructionBuildingId);
      if (
        constructionBuilding === undefined ||
        constructionBuilding.state.kind !== 'incomplete' ||
        !constructionBuilding.assignments.constructionWorkerIds.includes(citizen.id)
      ) {
        clearConstructionState(citizen, constructionBuildingId);
      } else if (citizen.route === null) {
        startConstructionTrip(pending.nextState, citizen, constructionBuilding);
      }
      if (citizen.constructionBuildingId !== null) continue;
    }

    if (citizen.routeNeedsReplan) continue;

    if (citizen.route !== null) {
      if (citizen.path === null) continue;
      if (citizen.pathIndex < citizen.path.length) continue;
      if (
        citizen.route.destinationCell !== null &&
        cellKey(citizen.route.destinationCell) === cellKey(citizen.position)
      ) {
        continue;
      }
      clearBuildingRoute(citizen);
    }

    if (citizen.path !== null && citizen.pathIndex < citizen.path.length) continue;
    if (citizen.homeBuildingId !== null && citizen.workBuildingId !== null) {
      startHomeWorkTrip(pending.nextState, citizen);
    } else {
      startWanderingSegment(pending.nextState, citizen);
    }
  }
  return true;
}

function processAdvancePathPlanning(pending: PendingTick): boolean {
  const cursor = pending.cursors.advancePathPlanning;
  const citizens = pending.nextState.citizens;
  if (cursor.workIndex >= citizens.length) return true;

  const citizen = citizens[cursor.workIndex];
  if (citizen === undefined) throw new Error('Path-planning cursor exceeded citizens.');

  const isInternalActivity = citizen.activity !== null;
  if (isInternalActivity) {
    if (
      citizen.internalPath !== null &&
      citizen.internalPathIndex < citizen.internalPath.length &&
      !citizen.internalPathNeedsReplan
    ) {
      cursor.workIndex += 1;
      return cursor.workIndex >= citizens.length;
    }
    if (
      citizen.internalTarget === null ||
      (citizen.internalPath !== null && citizen.internalPathIndex >= citizen.internalPath.length)
    ) {
      if (!selectNextInternalActivityTarget(pending.nextState, citizen)) {
        cursor.workIndex += 1;
        return cursor.workIndex >= citizens.length;
      }
    }
  } else if (citizen.path !== null && !citizen.routeNeedsReplan) {
    cursor.workIndex += 1;
    return cursor.workIndex >= citizens.length;
  }

  if (pending.occupancy === null) throw new Error('Movement occupancy was not frozen.');

  let search = pending.pathSearches.get(citizen.id);
  if (search === undefined) {
    const useTemporaryOccupancy = citizen.replanWithOccupancy;
    const activityBuilding =
      citizen.activity === null
        ? undefined
        : findBuildingById(pending.nextState, citizen.activity.buildingId);
    const route = citizen.route;
    const buildingPassability = createBuildingPassabilityCallback({
      buildings: pending.nextState.buildings,
      sourceBuildingId: route?.sourceBuildingId ?? null,
      destinationBuildingId: route?.destinationBuildingId ?? null,
      isAuthorizedForIncompleteBuilding: (building) =>
        isAuthorizedForIncompleteBuilding(citizen, building),
    });
    const target = isInternalActivity
      ? citizen.internalTarget
      : (route?.destinationCell ?? citizen.wanderingTarget);
    if (target === null) {
      throw new Error(`Citizen ${citizen.id} has no path target.`);
    }
    search = createAStarSearch({
      start: citizen.position,
      goal: target,
      isWalkable: (position) =>
        (isInternalActivity
          ? activityBuilding !== undefined && buildingContainsCell(activityBuilding, position)
          : (route === null ? isWithinWanderingBounds(citizen.wanderingAnchor, position) : true) &&
            buildingPassability(position)) &&
        (isInternalActivity || route !== null
          ? isStaticCellWalkable(pending.nextState, citizen, position)
          : true) &&
        (!useTemporaryOccupancy ||
          cellKey(position) === cellKey(citizen.position) ||
          !pending.occupancy?.has(cellKey(position))),
    });
    pending.pathSearches.set(citizen.id, search);
  }

  const result: AStarAdvanceResult = search.advance(1);
  pending.nextState.metrics.pathfindingExpansions += result.expansions;
  if (result.status === 'budget-exhausted') return false;

  const path = result.status === 'found' ? (result.path?.map(copyPosition) ?? []) : [];
  if (isInternalActivity) {
    citizen.internalPath = path;
    citizen.internalPathIndex = 0;
    citizen.internalPathNeedsReplan = false;
    citizen.replanWithOccupancy = false;
  } else {
    citizen.path = path;
    citizen.pathIndex = 0;
    citizen.routeNeedsReplan = false;
    citizen.replanWithOccupancy = false;
  }
  pending.pathSearches.delete(citizen.id);
  cursor.workIndex += 1;
  return cursor.workIndex >= citizens.length;
}

function processAccrueMovementCredit(pending: PendingTick): boolean {
  const cursor = pending.cursors.accrueMovementCredit;
  consumeSingleStage(cursor);

  for (const citizen of pending.nextState.citizens) {
    citizen.movementCredit = Math.min(
      FIXED_POINT_UNITS_PER_CELL,
      citizen.movementCredit + citizen.movementSpeed,
    );
  }
  return true;
}

function compareKeyedSidestepCandidates(
  seed: number,
  citizen: CitizenState,
  left: GridPosition,
  right: GridPosition,
): number {
  const leftKey = stableHash({
    seed,
    purpose: 'movement-sidestep',
    citizenId: citizen.id,
    blockedMovementCount: citizen.blockedMovementCount,
    from: citizen.position,
    target: left,
  });
  const rightKey = stableHash({
    seed,
    purpose: 'movement-sidestep',
    citizenId: citizen.id,
    blockedMovementCount: citizen.blockedMovementCount,
    from: citizen.position,
    target: right,
  });
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left.y - right.y || left.x - right.x;
}

function selectSidestepTarget(
  state: AuthoritativeState,
  citizen: CitizenState,
  occupancy: ReadonlyMap<string, CitizenId>,
  routeTarget: GridPosition,
): GridPosition | null {
  if (!occupancy.has(cellKey(routeTarget))) return null;

  const candidates: GridPosition[] = [];
  const deltas: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  for (const [xDelta, yDelta] of deltas) {
    const x = citizen.position.x + xDelta;
    const y = citizen.position.y + yDelta;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) continue;
    const candidate = createGridPosition(x, y);
    if (
      isCitizenMovementCellWithinBounds(state, citizen, candidate) &&
      isStaticCellWalkable(state, citizen, candidate) &&
      !occupancy.has(cellKey(candidate))
    ) {
      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) =>
    compareKeyedSidestepCandidates(state.seed, citizen, left, right),
  );
  return candidates[0] ?? null;
}

function processGenerateMovementProposals(pending: PendingTick): boolean {
  const cursor = pending.cursors.generateMovementProposals;
  const citizens = pending.nextState.citizens;
  if (cursor.workIndex >= citizens.length) return true;
  if (pending.occupancy === null) throw new Error('Movement occupancy was not frozen.');

  const citizen = citizens[cursor.workIndex];
  if (citizen === undefined) throw new Error('Movement-proposal cursor exceeded citizens.');

  const movementPath = citizen.activity === null ? citizen.path : citizen.internalPath;
  const movementPathIndex =
    citizen.activity === null ? citizen.pathIndex : citizen.internalPathIndex;
  if (
    citizen.movementCredit >= FIXED_POINT_UNITS_PER_CELL &&
    movementPath !== null &&
    movementPathIndex < movementPath.length
  ) {
    const routeTarget = movementPath[movementPathIndex];
    if (routeTarget === undefined) throw new Error('Movement path index exceeded path length.');
    if (!isAdjacent(citizen.position, routeTarget)) {
      throw new Error(`Movement path for ${citizen.id} was not orthogonal.`);
    }
    if (!isCitizenMovementCellWithinBounds(pending.nextState, citizen, routeTarget)) {
      throw new Error(`Movement path for ${citizen.id} exceeded its wandering anchor.`);
    }

    let target = routeTarget;
    let kind: MovementProposal['kind'] = citizen.activity === null ? 'route' : 'internal';
    if (citizen.blockedMovementCount >= 4) {
      const sidestepTarget = selectSidestepTarget(
        pending.nextState,
        citizen,
        pending.occupancy,
        routeTarget,
      );
      if (sidestepTarget !== null) {
        target = sidestepTarget;
        kind = 'sidestep';
      }
    }

    pending.proposals.push({
      citizenId: citizen.id,
      from: copyPosition(citizen.position),
      target: copyPosition(target),
      kind,
    });
    pending.nextState.metrics.movementProposals += 1;
  }

  cursor.workIndex += 1;
  return cursor.workIndex >= citizens.length;
}

function processResolveMovementConflicts(pending: PendingTick): boolean {
  const cursor = pending.cursors.resolveMovementConflicts;
  consumeSingleStage(cursor);
  if (pending.occupancy === null) throw new Error('Movement occupancy was not frozen.');

  const participants: MovementParticipant[] = pending.nextState.citizens.map((citizen) => ({
    id: citizen.id,
    position: citizen.position,
    movementCredit: citizen.movementCredit,
    blockedMovementCount: citizen.blockedMovementCount,
    remainingRouteCells:
      citizen.activity === null
        ? citizen.path === null
          ? 0
          : Math.max(0, citizen.path.length - citizen.pathIndex)
        : citizen.internalPath === null
          ? 0
          : Math.max(0, citizen.internalPath.length - citizen.internalPathIndex),
    goalStartTick: citizen.goalStartTick,
  }));
  pending.movementResolution = resolveMovementProposals({
    seed: pending.nextState.seed,
    occupancy: pending.occupancy,
    participants,
    proposals: pending.proposals,
    noProgressTicks: pending.nextState.movementNoProgressTicks,
    isMoveLegal: (participant, target) => {
      const citizen = pending.nextState.citizens.find(
        (candidate) => candidate.id === participant.id,
      );
      return (
        citizen !== undefined &&
        isCitizenMovementCellWithinBounds(pending.nextState, citizen, target) &&
        isStaticCellWalkable(pending.nextState, citizen, target)
      );
    },
  });
  return true;
}

function processCommitAcceptedMovement(pending: PendingTick): boolean {
  const cursor = pending.cursors.commitAcceptedMovement;
  consumeSingleStage(cursor);
  const movementResolution = pending.movementResolution;
  if (movementResolution === null) throw new Error('Movement conflicts were not resolved.');

  const nextPositions = new Map<CitizenId, GridPosition>();
  const acceptedTargets = new Set<string>();
  for (const accepted of movementResolution.accepted) {
    const targetKey = cellKey(accepted.target);
    if (acceptedTargets.has(targetKey)) {
      throw new Error(`Duplicate accepted target ${targetKey}.`);
    }
    acceptedTargets.add(targetKey);
    nextPositions.set(accepted.citizenId, accepted.target);
  }

  const citizensById = new Map<CitizenId, CitizenState>();
  for (const citizen of pending.nextState.citizens) citizensById.set(citizen.id, citizen);

  for (const citizenId of movementResolution.rejected) {
    const blockedCitizen = citizensById.get(citizenId);
    if (blockedCitizen === undefined) throw new Error(`Unknown citizen ${citizenId}.`);
    const previousBlockedCount = blockedCitizen.blockedMovementCount;
    blockedCitizen.blockedMovementCount += 1;
    if (previousBlockedCount < 8 && blockedCitizen.blockedMovementCount >= 8) {
      if (blockedCitizen.activity !== null) {
        blockedCitizen.internalPathNeedsReplan = true;
        blockedCitizen.internalPath = null;
        blockedCitizen.internalPathIndex = 0;
        blockedCitizen.replanWithOccupancy = true;
      } else {
        blockedCitizen.routeNeedsReplan = true;
        blockedCitizen.replanWithOccupancy = true;
        blockedCitizen.path = null;
        blockedCitizen.pathIndex = 0;
      }
    }
    pending.nextState.metrics.blockedMoves += 1;
  }

  for (const accepted of movementResolution.accepted) {
    const citizen = citizensById.get(accepted.citizenId);
    if (citizen === undefined) throw new Error(`Unknown citizen ${accepted.citizenId}.`);

    const nextPosition = nextPositions.get(citizen.id);
    if (nextPosition === undefined) {
      throw new Error(`Accepted citizen ${citizen.id} has no next position.`);
    }

    citizen.position = copyPosition(nextPosition);
    citizen.movementCredit -= FIXED_POINT_UNITS_PER_CELL;
    if (citizen.movementCredit < 0) {
      throw new Error(`Citizen ${citizen.id} moved without enough fixed-point credit.`);
    }

    if (accepted.implicit) {
      if (citizen.activity !== null) {
        citizen.internalPath = null;
        citizen.internalPathIndex = 0;
        citizen.internalPathNeedsReplan = true;
      } else {
        citizen.path = null;
        citizen.pathIndex = 0;
        citizen.routeNeedsReplan = true;
        citizen.replanWithOccupancy = true;
      }
    } else if (accepted.kind === 'internal') {
      if (citizen.internalPath === null) {
        throw new Error(`Citizen ${citizen.id} moved internally without a path.`);
      }
      citizen.internalPathIndex += 1;
    } else if (accepted.kind === 'sidestep') {
      if (citizen.activity !== null) {
        citizen.internalPath = null;
        citizen.internalPathIndex = 0;
        citizen.internalPathNeedsReplan = true;
      } else {
        citizen.path = null;
        citizen.pathIndex = 0;
        citizen.routeNeedsReplan = true;
        citizen.replanWithOccupancy = false;
      }
    } else {
      if (citizen.path === null) throw new Error(`Citizen ${citizen.id} moved without a path.`);
      citizen.pathIndex += 1;
    }

    citizen.blockedMovementCount = 0;
    ensureChunkAt(pending.nextState.world, citizen.position);
    pending.nextState.metrics.committedMoves += 1;
  }

  if (pending.proposals.length > 0 && movementResolution.accepted.length === 0) {
    pending.nextState.movementNoProgressTicks += 1;
  } else {
    pending.nextState.movementNoProgressTicks = 0;
  }

  return true;
}

function processDecrementTimers(pending: PendingTick): boolean {
  const cursor = pending.cursors.decrementTimers;
  consumeSingleStage(cursor);
  for (const citizen of pending.nextState.citizens) {
    if (
      citizen.activity !== null &&
      citizen.activity.kind !== 'construction' &&
      citizen.activity.ticksRemaining > 0
    ) {
      citizen.activity.ticksRemaining = decrementBuildingActivityTicks(
        citizen.activity.ticksRemaining,
      );
    }
  }
  return true;
}

function processCompleteExpiredActivities(pending: PendingTick): boolean {
  const cursor = pending.cursors.completeExpiredActivities;
  consumeSingleStage(cursor);
  for (const citizen of pending.nextState.citizens) {
    if (
      citizen.activity !== null &&
      citizen.activity.kind !== 'construction' &&
      citizen.activity.ticksRemaining <= 0
    ) {
      clearBuildingActivity(citizen);
    }
  }
  return true;
}

function processArrivals(pending: PendingTick): boolean {
  const cursor = pending.cursors.processArrivals;
  consumeSingleStage(cursor);
  for (const citizen of pending.nextState.citizens) {
    if (citizen.activity !== null || citizen.route === null) continue;
    const destinationCell = citizen.route.destinationCell;
    const destinationBuildingId = citizen.route.destinationBuildingId;
    if (destinationCell === null || destinationBuildingId === null) continue;
    if (cellKey(destinationCell) !== cellKey(citizen.position)) continue;
    const destination = findBuildingById(pending.nextState, destinationBuildingId);
    if (destination === undefined || !buildingContainsCell(destination, citizen.position)) {
      clearBuildingRoute(citizen);
      continue;
    }
    pending.arrivedBuildingIds.set(citizen.id, {
      buildingId: destination.id,
      purpose: citizen.route.purpose,
    });
  }
  return true;
}

function processStartBuildingActivities(pending: PendingTick): boolean {
  const cursor = pending.cursors.startBuildingActivities;
  consumeSingleStage(cursor);
  for (const citizen of pending.nextState.citizens) {
    const arrival = pending.arrivedBuildingIds.get(citizen.id);
    if (arrival === undefined) continue;
    const building = findBuildingById(pending.nextState, arrival.buildingId);
    if (arrival.purpose === 'construction') {
      startConstructionBuildingActivity(pending.nextState, citizen, arrival.buildingId);
    } else if (building?.state.kind === 'complete') {
      startStayActivity(pending.nextState, citizen, arrival.buildingId, arrival.purpose);
    } else {
      clearBuildingRoute(citizen);
    }
  }
  return true;
}

/** Narrow hook reserved for the future leisure cooldown multiplier. */
function workplaceDataMultiplier(): number {
  return 1;
}

function processProduceWorkplaceData(pending: PendingTick): boolean {
  const cursor = pending.cursors.produceWorkplaceData;
  consumeSingleStage(cursor);

  for (const citizen of pending.nextState.citizens) {
    const arrival = pending.arrivedBuildingIds.get(citizen.id);
    if (arrival?.purpose !== 'work' || citizen.workBuildingId !== arrival.buildingId) continue;
    const workplace = findCompletedBuilding(pending.nextState, arrival.buildingId, 'small-shop');
    if (workplace === undefined) continue;
    pending.nextState.data += workplaceDataMultiplier();
  }
  return true;
}

function processApplyConstructionLabor(pending: PendingTick): boolean {
  const cursor = pending.cursors.applyConstructionLabor;
  consumeSingleStage(cursor);
  const state = pending.nextState;

  for (let index = 0; index < state.buildings.length; index += 1) {
    const building = state.buildings[index];
    if (building === undefined || building.state.kind !== 'incomplete') continue;

    const assignedWorkerIds = new Set(building.assignments.constructionWorkerIds);
    let workersInside = 0;
    for (const citizen of state.citizens) {
      if (
        assignedWorkerIds.has(citizen.id) &&
        citizen.constructionBuildingId === building.id &&
        citizen.activity?.kind === 'construction' &&
        buildingContainsCell(building, citizen.position)
      ) {
        workersInside += 1;
      }
    }
    if (workersInside === 0) continue;

    const laborCompleted = Math.min(
      building.state.laborRequired,
      building.state.laborCompleted + workersInside,
    );
    state.buildings[index] = createBuildingInstance({
      id: building.id,
      zoneId: building.zoneId,
      archetype: building.archetypeId,
      origin: building.origin,
      transform: building.transform,
      state: {
        kind: 'incomplete',
        laborCompleted,
        laborRequired: building.state.laborRequired,
      },
      assignments: building.assignments,
    });
  }
  return true;
}

function processCompleteBuildings(pending: PendingTick): boolean {
  const cursor = pending.cursors.completeBuildings;
  consumeSingleStage(cursor);
  const state = pending.nextState;

  for (let index = 0; index < state.buildings.length; index += 1) {
    const building = state.buildings[index];
    if (
      building === undefined ||
      building.state.kind !== 'incomplete' ||
      building.state.laborCompleted < building.state.laborRequired
    ) {
      continue;
    }

    const constructionWorkerIds = new Set(building.assignments.constructionWorkerIds);
    state.buildings[index] = replaceBuildingAsComplete(building, {
      constructionWorkerIds: [],
      residentCitizenIds: building.assignments.residentCitizenIds,
      workerCitizenIds: building.assignments.workerCitizenIds,
      visitorReservationCitizenIds: building.assignments.visitorReservationCitizenIds,
    });
    pending.completedBuildingIds.add(building.id);
    for (const citizen of state.citizens) {
      if (constructionWorkerIds.has(citizen.id) || citizen.constructionBuildingId === building.id) {
        clearConstructionState(citizen, building.id);
      }
    }
  }
  return true;
}

function processApplyAssignmentChanges(pending: PendingTick): boolean {
  const cursor = pending.cursors.applyAssignmentChanges;
  consumeSingleStage(cursor);
  const completedBuildingIds = [...pending.completedBuildingIds].sort(compareStableIds);
  for (const buildingId of completedBuildingIds) {
    const building = findBuildingById(pending.nextState, buildingId);
    if (building === undefined || building.state.kind !== 'complete') continue;
    if (building.archetypeId === 'single-house') {
      applyHomeCompletionAssignments(pending.nextState, building);
    } else if (building.archetypeId === 'small-shop') {
      applyWorkCompletionAssignments(pending.nextState, building);
    }
  }
  return true;
}

function processApplyQueuedCommands(pending: PendingTick): boolean {
  const cursor = pending.cursors.applyQueuedCommands;
  consumeSingleStage(cursor);

  for (const command of pending.commands) {
    pending.commandResults.push(
      applyPlaceZoneCommand(pending.nextState, command, pending.nextState.tick),
    );
  }
  return true;
}

function processStage(pending: PendingTick, stage: TickStage): boolean {
  switch (stage) {
    case 'apply-queued-commands':
      return processApplyQueuedCommands(pending);
    case 'apply-zone-removals':
      return consumeSingleStage(pending.cursors.applyZoneRemovals);
    case 'freeze-citizen-occupancy':
      return processFreezeCitizenOccupancy(pending);
    case 'decrement-timers':
      return processDecrementTimers(pending);
    case 'complete-expired-activities':
      return processCompleteExpiredActivities(pending);
    case 'mark-citizens-requiring-goal':
      return consumeSingleStage(pending.cursors.markCitizensRequiringGoal);
    case 'fill-construction-assignments':
      return processFillConstructionAssignments(pending);
    case 'select-non-construction-goals':
      return processSelectNonConstructionGoals(pending);
    case 'advance-path-planning':
      return processAdvancePathPlanning(pending);
    case 'accrue-movement-credit':
      return processAccrueMovementCredit(pending);
    case 'generate-movement-proposals':
      return processGenerateMovementProposals(pending);
    case 'resolve-movement-conflicts':
      return processResolveMovementConflicts(pending);
    case 'commit-accepted-movement':
      return processCommitAcceptedMovement(pending);
    case 'process-arrivals':
      return processArrivals(pending);
    case 'start-building-activities':
      return processStartBuildingActivities(pending);
    case 'produce-workplace-data':
      return processProduceWorkplaceData(pending);
    case 'apply-construction-labor':
      return processApplyConstructionLabor(pending);
    case 'complete-buildings':
      return processCompleteBuildings(pending);
    case 'apply-assignment-changes':
      return processApplyAssignmentChanges(pending);
    case 'evaluate-population-growth':
      consumeSingleStage(pending.cursors.evaluatePopulationGrowth);
      processPopulationGrowth(pending.nextState);
      return true;
    case 'advance-building-planning':
      return processAdvanceBuildingPlanning(pending);
    case 'commit-completed-tick':
      return consumeSingleStage(pending.cursors.commitCompletedTick);
  }
}

function validateWorkBudget(maxWorkUnits: number): void {
  if (!Number.isSafeInteger(maxWorkUnits) || maxWorkUnits <= 0) {
    throw new Error(
      `maxWorkUnits must be a positive safe integer; received ${String(maxWorkUnits)}.`,
    );
  }
}

function hashableState(state: AuthoritativeState): unknown {
  return {
    seed: state.seed,
    tick: state.tick,
    data: state.data,
    homeStayTicks: state.homeStayTicks,
    workStayTicks: state.workStayTicks,
    citizens: state.citizens,
    zones: state.zones,
    buildings: state.buildings,
    nextZoneId: state.nextZoneId,
    nextBuildingId: state.nextBuildingId,
    nextCitizenId: state.nextCitizenId,
    planningChance: state.planningChance,
    constructionLaborRequirements: state.constructionLaborRequirements,
    lastPlanningJob: state.lastPlanningJob,
    populationGrowthSequence: state.populationGrowthSequence,
    populationGrowthRollOverride: state.populationGrowthRollOverride,
    chunks: getSortedChunks(state.world),
    metrics: state.metrics,
  };
}

export function createSimulation(options: SimulationOptions = {}): Simulation {
  let committedState = createInitialState(
    options.seed ?? 0,
    options.planningChance ?? DEFAULT_PLANNING_CHANCE,
    createConstructionLaborRequirements(options.constructionLaborRequirements),
    options.homeStayTicks ?? DEFAULT_HOME_STAY_TICKS,
    options.workStayTicks ?? DEFAULT_WORK_STAY_TICKS,
    options.populationGrowthRollOverride,
  );
  let pendingTick: PendingTick | null = null;
  let queuedCommands: SimulationCommand[] = [];
  let lastCommandResults: readonly PlaceZoneCommandResult[] = [];

  return {
    queueCommand(command: SimulationCommand): void {
      queuedCommands.push(copyPlaceZoneCommand(command));
    },
    placeZone(command: PlaceZoneCommand): void {
      queuedCommands.push(copyPlaceZoneCommand(command));
    },
    getZonePlacementPreview(command: PlaceZoneCommand): ZonePlacementPreview {
      const validation = validatePlaceZoneCommand(committedState, command);
      if (validation.accepted) {
        return {
          valid: true,
          rect: copyRect(validation.placement.rect),
          currentCost: validation.placement.cost,
        };
      }

      return {
        valid: false,
        rect: copyRawRect(command.rect),
        currentCost: validation.currentCost,
        reason: validation.reason,
      };
    },
    getLastCommandResults(): readonly PlaceZoneCommandResult[] {
      return lastCommandResults.map(copyCommandResult);
    },
    advanceTickWork(maxWorkUnits: number): TickWorkResult {
      validateWorkBudget(maxWorkUnits);

      if (pendingTick === null) {
        const commandsForTick = queuedCommands;
        queuedCommands = [];
        pendingTick = createPendingTick(committedState, commandsForTick);
      }
      const activeTick = pendingTick;
      pendingTick = activeTick;

      let workUnitsConsumed = 0;
      let lastStage: TickStage | undefined;

      while (workUnitsConsumed < maxWorkUnits) {
        const stage = TICK_STAGE_ORDER[activeTick.nextStageIndex];
        if (stage === undefined) throw new Error('Pending tick has no remaining stage.');

        const stageComplete = processStage(activeTick, stage);
        workUnitsConsumed += 1;
        lastStage = stage;

        if (stage === 'commit-completed-tick') {
          if (!stageComplete) throw new Error('Completed-tick stage did not finish.');
          committedState = activeTick.nextState;
          lastCommandResults = activeTick.commandResults.map(copyCommandResult);
          pendingTick = null;
          return {
            status: 'committed',
            stage,
            workUnitsConsumed,
          };
        }

        if (stageComplete) activeTick.nextStageIndex += 1;
      }

      if (lastStage === undefined) {
        throw new Error('A valid work budget must consume at least one stage.');
      }

      return {
        status: 'in-progress',
        stage: lastStage,
        workUnitsConsumed,
      };
    },
    getSnapshot(): SimulationSnapshot {
      return createSnapshot(committedState);
    },
    getMetrics(): MovementMetrics {
      return createMetricsSnapshot(committedState.metrics);
    },
    getDeterminismHash(): string {
      return stableHash(hashableState(committedState));
    },
  };
}
