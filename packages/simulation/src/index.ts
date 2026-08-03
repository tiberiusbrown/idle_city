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
/** Generic activity duration used until domain-specific stay rules are added. */
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

export type BuildingActivityKind = 'generic';

export interface CitizenRouteSnapshot {
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
  readonly route: CitizenRouteSnapshot | null;
  readonly activity: BuildingActivitySnapshot | null;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly data: number;
  readonly population: number;
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
}

interface CitizenRouteState {
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
  readonly citizens: CitizenState[];
  readonly zones: ZoneState[];
  readonly buildings: BuildingInstance[];
  nextZoneId: number;
  nextBuildingId: number;
  readonly world: WorldState;
  readonly metrics: MutableMovementMetrics;
  readonly planningChance: number;
  lastPlanningJob: PlanningJobSnapshot;
  movementNoProgressTicks: number;
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
  readonly arrivedBuildingIds: Map<CitizenId, BuildingId>;
  movementResolution: MovementResolution | null;
  planningJob: BuildingPlanningJob | null;
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

function copyPosition(position: GridPosition): GridPosition {
  return createGridPosition(position.x, position.y);
}

function copyRoute(route: CitizenRouteState | null): CitizenRouteState | null {
  if (route === null) return null;
  return {
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

function createInitialState(seed: number, planningChance: number): AuthoritativeState {
  const validatedSeed = validateSeed(seed);
  const validatedPlanningChance = validatePlanningChance(planningChance);
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
    citizens,
    zones: [],
    buildings: [],
    nextZoneId: 1,
    nextBuildingId: 1,
    world,
    metrics: createMutableMetrics(),
    planningChance: validatedPlanningChance,
    lastPlanningJob: createIdlePlanningJobSnapshot(),
    movementNoProgressTicks: 0,
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
    citizens: state.citizens.map((citizen) => ({
      id: citizen.id,
      position: copySnapshotPosition(citizen.position),
      previousPosition: copySnapshotPosition(citizen.previousPosition),
      movementCredit: citizen.movementCredit,
      wanderingAnchor: copySnapshotPosition(citizen.wanderingAnchor),
      route:
        citizen.route === null
          ? null
          : {
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
      citizens: state.citizens.map(copyCitizenForPending),
      zones: state.zones.map(copyZoneState),
      buildings: state.buildings.map(cloneBuildingInstance),
      nextZoneId: state.nextZoneId,
      nextBuildingId: state.nextBuildingId,
      world: cloneWorld(state.world),
      metrics: copyMetrics(state.metrics),
      planningChance: state.planningChance,
      lastPlanningJob: { ...state.lastPlanningJob },
      movementNoProgressTicks: state.movementNoProgressTicks,
    },
    cursors: createTickCursors(),
    commands: commands.map(copyPlaceZoneCommand),
    commandResults: [],
    nextStageIndex: 0,
    occupancy: null,
    pathSearches: new Map(),
    proposals: [],
    arrivedBuildingIds: new Map(),
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

function startGenericBuildingActivity(
  state: AuthoritativeState,
  citizen: CitizenState,
  buildingId: BuildingId,
): void {
  const building = findBuildingById(state, buildingId);
  if (building === undefined || !buildingContainsCell(building, citizen.position)) {
    clearBuildingRoute(citizen);
    return;
  }
  if (
    building.state.kind === 'incomplete' &&
    !isAuthorizedForIncompleteBuilding(citizen, building)
  ) {
    clearBuildingRoute(citizen);
    return;
  }

  citizen.activity = {
    buildingId,
    kind: 'generic',
    ticksRemaining: DEFAULT_GENERIC_BUILDING_ACTIVITY_TICKS,
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

const PLANNING_ARCHETYPE_BY_ZONE_TYPE: Readonly<Record<ZoneType, BuildingArchetypeId>> =
  Object.freeze({
    living: 'single-house',
    working: 'small-shop',
    leisure: 'small-park',
  });

function countConstructionAssignedCitizens(state: AuthoritativeState): number {
  const assignedCitizenIds = new Set<CitizenId>();
  for (const building of state.buildings) {
    if (building.state.kind !== 'incomplete') continue;
    for (const citizenId of building.assignments.constructionWorkerIds) {
      assignedCitizenIds.add(citizenId);
    }
  }
  return assignedCitizenIds.size;
}

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
      laborRequired: archetype.labor,
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

function processSelectNonConstructionGoals(pending: PendingTick): boolean {
  const cursor = pending.cursors.selectNonConstructionGoals;
  consumeSingleStage(cursor);

  for (const citizen of pending.nextState.citizens) {
    if (citizen.activity !== null) continue;
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
      startWanderingSegment(pending.nextState, citizen);
      continue;
    }

    if (citizen.path !== null && citizen.pathIndex < citizen.path.length) continue;
    startWanderingSegment(pending.nextState, citizen);
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
    if (citizen.activity !== null && citizen.activity.ticksRemaining > 0) {
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
    if (citizen.activity !== null && citizen.activity.ticksRemaining <= 0) {
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
    pending.arrivedBuildingIds.set(citizen.id, destination.id);
  }
  return true;
}

function processStartBuildingActivities(pending: PendingTick): boolean {
  const cursor = pending.cursors.startBuildingActivities;
  consumeSingleStage(cursor);
  for (const citizen of pending.nextState.citizens) {
    const buildingId = pending.arrivedBuildingIds.get(citizen.id);
    if (buildingId === undefined) continue;
    startGenericBuildingActivity(pending.nextState, citizen, buildingId);
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
      return consumeSingleStage(pending.cursors.fillConstructionAssignments);
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
      return consumeSingleStage(pending.cursors.produceWorkplaceData);
    case 'apply-construction-labor':
      return consumeSingleStage(pending.cursors.applyConstructionLabor);
    case 'complete-buildings':
      return consumeSingleStage(pending.cursors.completeBuildings);
    case 'apply-assignment-changes':
      return consumeSingleStage(pending.cursors.applyAssignmentChanges);
    case 'evaluate-population-growth':
      return consumeSingleStage(pending.cursors.evaluatePopulationGrowth);
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
    citizens: state.citizens,
    zones: state.zones,
    buildings: state.buildings,
    nextZoneId: state.nextZoneId,
    nextBuildingId: state.nextBuildingId,
    planningChance: state.planningChance,
    lastPlanningJob: state.lastPlanningJob,
    chunks: getSortedChunks(state.world),
    metrics: state.metrics,
  };
}

export function createSimulation(options: SimulationOptions = {}): Simulation {
  let committedState = createInitialState(
    options.seed ?? 0,
    options.planningChance ?? DEFAULT_PLANNING_CHANCE,
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
