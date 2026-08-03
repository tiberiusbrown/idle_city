import {
  createCitizenId,
  createGridPosition,
  stableHash,
  type CitizenId,
  type GridPosition,
} from '@idle-city/shared';
import { createAStarSearch, type AStarAdvanceResult, type AStarSearch } from './pathfinding';
import {
  movementCellKey,
  resolveMovementProposals,
  type MovementParticipant,
  type MovementProposal,
  type MovementResolution,
} from './movement';
import { cloneWorld, createWorld, ensureChunkAt, getSortedChunks, type WorldState } from './world';

export type { CitizenId, GridPosition } from '@idle-city/shared';
export {
  CHUNK_SIZE,
  getChunkCoordinates,
  getChunkKey,
  getChunkLocalPosition,
} from '@idle-city/shared';
export type { ChunkCoordinates } from '@idle-city/shared';
export { createAStarSearch } from './pathfinding';
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

export const FIXED_POINT_UNITS_PER_CELL = 1024;
export const DEFAULT_CITIZEN_MOVEMENT_SPEED = 512;
export const WANDERING_CHEBYSHEV_RADIUS = 16;

/** Compatibility aliases for callers that name the balance values directly. */
export const MOVEMENT_UNITS_PER_CELL = FIXED_POINT_UNITS_PER_CELL;
export const CITIZEN_MOVEMENT_SPEED = DEFAULT_CITIZEN_MOVEMENT_SPEED;
export const WANDER_RADIUS = WANDERING_CHEBYSHEV_RADIUS;

export interface SimulationOptions {
  readonly seed?: number;
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
}

export interface CitizenSnapshot {
  readonly id: CitizenId;
  readonly position: GridPosition;
  readonly previousPosition: GridPosition;
  readonly movementCredit: number;
  readonly wanderingAnchor: GridPosition;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly data: number;
  readonly population: number;
  readonly citizens: readonly CitizenSnapshot[];
  readonly zones: readonly never[];
  readonly buildings: readonly never[];
}

export interface Simulation {
  advanceTickWork(maxWorkUnits: number): TickWorkResult;
  getSnapshot(): SimulationSnapshot;
  getMetrics(): MovementMetrics;
  getDeterminismHash(): string;
}

interface MutableMovementMetrics {
  movementProposals: number;
  committedMoves: number;
  blockedMoves: number;
  pathfindingExpansions: number;
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
  routeNeedsReplan: boolean;
  replanWithOccupancy: boolean;
}

interface AuthoritativeState {
  readonly seed: number;
  readonly tick: number;
  readonly data: number;
  readonly citizens: CitizenState[];
  readonly world: WorldState;
  readonly metrics: MutableMovementMetrics;
  movementNoProgressTicks: number;
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
  nextStageIndex: number;
  occupancy: Map<string, CitizenId> | null;
  readonly pathSearches: Map<CitizenId, AStarSearch>;
  readonly proposals: MovementProposal[];
  movementResolution: MovementResolution | null;
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
  };
}

function copyMetrics(metrics: MutableMovementMetrics): MutableMovementMetrics {
  return {
    movementProposals: metrics.movementProposals,
    committedMoves: metrics.committedMoves,
    blockedMoves: metrics.blockedMoves,
    pathfindingExpansions: metrics.pathfindingExpansions,
  };
}

function validateSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`Simulation seeds must be safe integers; received ${String(seed)}.`);
  }
  return seed;
}

function copyPosition(position: GridPosition): GridPosition {
  return createGridPosition(position.x, position.y);
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
    routeNeedsReplan: false,
    replanWithOccupancy: false,
  };
}

function createInitialState(seed: number): AuthoritativeState {
  const validatedSeed = validateSeed(seed);
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
    world,
    metrics: createMutableMetrics(),
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
    routeNeedsReplan: citizen.routeNeedsReplan,
    replanWithOccupancy: citizen.replanWithOccupancy,
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
    })),
    zones: [],
    buildings: [],
  };
}

function createMetricsSnapshot(metrics: MutableMovementMetrics): MovementMetrics {
  return {
    movementProposals: metrics.movementProposals,
    committedMoves: metrics.committedMoves,
    blockedMoves: metrics.blockedMoves,
    pathfindingExpansions: metrics.pathfindingExpansions,
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

function createPendingTick(state: AuthoritativeState): PendingTick {
  return {
    nextState: {
      seed: state.seed,
      tick: state.tick + 1,
      data: state.data,
      citizens: state.citizens.map(copyCitizenForPending),
      world: cloneWorld(state.world),
      metrics: copyMetrics(state.metrics),
      movementNoProgressTicks: state.movementNoProgressTicks,
    },
    cursors: createTickCursors(),
    nextStageIndex: 0,
    occupancy: null,
    pathSearches: new Map(),
    proposals: [],
    movementResolution: null,
  };
}

function consumeSingleStage(cursor: StageCursor): boolean {
  if (cursor.workIndex !== 0) {
    throw new Error('A tick stage was processed more than once.');
  }
  cursor.workIndex = 1;
  return true;
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
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
  ensureChunkAt(state.world, citizen.wanderingAnchor);
  ensureChunkAt(state.world, citizen.wanderingTarget);
}

function processFreezeCitizenOccupancy(pending: PendingTick): boolean {
  const cursor = pending.cursors.freezeCitizenOccupancy;
  consumeSingleStage(cursor);

  const occupancy = new Map<string, CitizenId>();
  for (const citizen of pending.nextState.citizens) {
    const key = cellKey(citizen.position);
    if (occupancy.has(key)) {
      throw new Error(`Citizens overlap at ${key} before movement resolution.`);
    }
    occupancy.set(key, citizen.id);

    if (citizen.blockedMovementCount >= 8 && !citizen.routeNeedsReplan) {
      citizen.routeNeedsReplan = true;
      citizen.replanWithOccupancy = true;
      citizen.path = null;
      citizen.pathIndex = 0;
    }
  }
  pending.occupancy = occupancy;
  return true;
}

function processSelectNonConstructionGoals(pending: PendingTick): boolean {
  const cursor = pending.cursors.selectNonConstructionGoals;
  consumeSingleStage(cursor);

  for (const citizen of pending.nextState.citizens) {
    if (citizen.routeNeedsReplan) continue;
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

  if (citizen.path !== null && !citizen.routeNeedsReplan) {
    cursor.workIndex += 1;
    return cursor.workIndex >= citizens.length;
  }

  if (pending.occupancy === null) throw new Error('Movement occupancy was not frozen.');

  let search = pending.pathSearches.get(citizen.id);
  if (search === undefined) {
    const useTemporaryOccupancy = citizen.replanWithOccupancy;
    search = createAStarSearch({
      start: citizen.position,
      goal: citizen.wanderingTarget,
      isWalkable: (position) =>
        isWithinWanderingBounds(citizen.wanderingAnchor, position) &&
        (!useTemporaryOccupancy ||
          cellKey(position) === cellKey(citizen.position) ||
          !pending.occupancy?.has(cellKey(position))),
    });
    pending.pathSearches.set(citizen.id, search);
  }

  const result: AStarAdvanceResult = search.advance(1);
  pending.nextState.metrics.pathfindingExpansions += result.expansions;
  if (result.status === 'budget-exhausted') return false;

  citizen.path = result.status === 'found' ? (result.path?.map(copyPosition) ?? []) : [];
  citizen.pathIndex = 0;
  citizen.routeNeedsReplan = false;
  citizen.replanWithOccupancy = false;
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
      isWithinWanderingBounds(citizen.wanderingAnchor, candidate) &&
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

  if (
    citizen.movementCredit >= FIXED_POINT_UNITS_PER_CELL &&
    citizen.path !== null &&
    citizen.pathIndex < citizen.path.length
  ) {
    const routeTarget = citizen.path[citizen.pathIndex];
    if (routeTarget === undefined) throw new Error('Movement path index exceeded path length.');
    if (!isAdjacent(citizen.position, routeTarget)) {
      throw new Error(`Movement path for ${citizen.id} was not orthogonal.`);
    }
    if (!isWithinWanderingBounds(citizen.wanderingAnchor, routeTarget)) {
      throw new Error(`Movement path for ${citizen.id} exceeded its wandering anchor.`);
    }

    let target = routeTarget;
    let kind: MovementProposal['kind'] = 'route';
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
      citizen.path === null ? 0 : Math.max(0, citizen.path.length - citizen.pathIndex),
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
      return citizen !== undefined && isWithinWanderingBounds(citizen.wanderingAnchor, target);
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
      blockedCitizen.routeNeedsReplan = true;
      blockedCitizen.replanWithOccupancy = true;
      blockedCitizen.path = null;
      blockedCitizen.pathIndex = 0;
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
      citizen.path = null;
      citizen.pathIndex = 0;
      citizen.routeNeedsReplan = true;
      citizen.replanWithOccupancy = true;
    } else if (accepted.kind === 'sidestep') {
      citizen.path = null;
      citizen.pathIndex = 0;
      citizen.routeNeedsReplan = true;
      citizen.replanWithOccupancy = false;
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

function processStage(pending: PendingTick, stage: TickStage): boolean {
  switch (stage) {
    case 'apply-queued-commands':
      return consumeSingleStage(pending.cursors.applyQueuedCommands);
    case 'apply-zone-removals':
      return consumeSingleStage(pending.cursors.applyZoneRemovals);
    case 'freeze-citizen-occupancy':
      return processFreezeCitizenOccupancy(pending);
    case 'decrement-timers':
      return consumeSingleStage(pending.cursors.decrementTimers);
    case 'complete-expired-activities':
      return consumeSingleStage(pending.cursors.completeExpiredActivities);
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
      return consumeSingleStage(pending.cursors.processArrivals);
    case 'start-building-activities':
      return consumeSingleStage(pending.cursors.startBuildingActivities);
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
      return consumeSingleStage(pending.cursors.advanceBuildingPlanning);
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
    chunks: getSortedChunks(state.world),
    metrics: state.metrics,
    zones: [],
    buildings: [],
  };
}

export function createSimulation(options: SimulationOptions = {}): Simulation {
  let committedState = createInitialState(options.seed ?? 0);
  let pendingTick: PendingTick | null = null;

  return {
    advanceTickWork(maxWorkUnits: number): TickWorkResult {
      validateWorkBudget(maxWorkUnits);

      const activeTick = pendingTick ?? createPendingTick(committedState);
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
