import type { ChunkCoordinate, GridPosition } from '@idle-city/shared';
import { findGridPathDetailed, type PathSearchStatus } from './pathfinding';

export type MovementBlockReason = 'invalid' | 'target-conflict' | 'dependency' | 'ordinary-swap';

export interface MovementCandidate {
  readonly id: string;
  readonly position: GridPosition;
  readonly route: readonly GridPosition[];
  readonly routeIndex: number;
  readonly waitTicks: number;
  readonly tripStartedTick: number;
}

export interface MovementProposal {
  readonly citizenId: string;
  readonly from: GridPosition;
  readonly to: GridPosition;
  readonly waitTicks: number;
  readonly remainingRouteCells: number;
  readonly tripStartedTick: number;
  readonly valid: boolean;
  readonly blockReason?: 'invalid';
}

export interface MovementMove {
  readonly citizenId: string;
  readonly from: GridPosition;
  readonly to: GridPosition;
  readonly cycleLength: number;
  readonly emergencySwap: boolean;
}

export interface MovementBlockedProposal {
  readonly citizenId: string;
  readonly from: GridPosition;
  readonly to: GridPosition;
  readonly reason: MovementBlockReason;
}

export interface MovementSwapPair {
  readonly key: string;
  readonly leftId: string;
  readonly rightId: string;
  readonly leftFrom: GridPosition;
  readonly leftTo: GridPosition;
  readonly rightFrom: GridPosition;
  readonly rightTo: GridPosition;
}

export interface MovementProposalInput {
  readonly candidates: readonly MovementCandidate[];
  readonly isActive: (position: GridPosition) => boolean;
  readonly isWalkable: (position: GridPosition) => boolean;
}

export interface MovementResolutionInput {
  readonly proposals: readonly MovementProposal[];
  readonly movingOccupancy: ReadonlyMap<string, string>;
  readonly emergencySwapPairs?: ReadonlySet<string>;
}

export interface MovementReplanInput {
  readonly chunkSize: number;
  readonly activeChunks: readonly ChunkCoordinate[];
  readonly start: GridPosition;
  readonly goal: GridPosition;
  readonly currentRoute: readonly GridPosition[];
  readonly currentRouteIndex: number;
  readonly temporaryBlocked: ReadonlySet<string>;
  readonly isWalkable: (position: GridPosition) => boolean;
  readonly maxNodes: number;
}

export interface MovementReplanResult {
  readonly status: PathSearchStatus;
  readonly path: readonly GridPosition[];
  readonly routeIndex: number;
  readonly routeChanged: boolean;
  readonly nodesExpanded: number;
  readonly chunksTouched: number;
}

export const MOVEMENT_REPLAN_FIRST_WAIT_TICKS = 8;
export const MOVEMENT_REPLAN_INTERVAL_TICKS = 8;
export const MOVEMENT_DEADLOCK_RECOVERY_BLOCKED_TICKS = 12;

export function isMovementReplanDue(waitTicks: number): boolean {
  return (
    waitTicks >= MOVEMENT_REPLAN_FIRST_WAIT_TICKS &&
    (waitTicks - MOVEMENT_REPLAN_FIRST_WAIT_TICKS) % MOVEMENT_REPLAN_INTERVAL_TICKS === 0
  );
}

export function isMovementDeadlockRecoveryDue(
  previousBlockedTicks: number,
  identicalPairState: boolean,
): boolean {
  return identicalPairState && previousBlockedTicks + 1 >= MOVEMENT_DEADLOCK_RECOVERY_BLOCKED_TICKS;
}

export interface MovementResolution {
  readonly accepted: readonly MovementMove[];
  readonly blocked: readonly MovementBlockedProposal[];
  readonly targetConflicts: number;
  readonly dependencyBlocks: number;
  readonly cyclesCommitted: number;
  readonly ordinarySwapsRejected: number;
  readonly emergencySwaps: number;
  readonly directSwapPairs: readonly MovementSwapPair[];
}

function coordinateKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positionsEqual(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function adjacent(left: GridPosition, right: GridPosition): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function copyPosition(position: GridPosition): GridPosition {
  return { x: position.x, y: position.y };
}

function compareCitizenIds(left: string, right: string): number {
  return compareStrings(left, right);
}

/**
 * Complete movement priority. A negative result means the left proposal has
 * higher priority and must win a same-target tie.
 */
export function compareMovementProposals(
  left: Pick<
    MovementProposal,
    'citizenId' | 'waitTicks' | 'remainingRouteCells' | 'tripStartedTick'
  >,
  right: Pick<
    MovementProposal,
    'citizenId' | 'waitTicks' | 'remainingRouteCells' | 'tripStartedTick'
  >,
): number {
  if (left.waitTicks !== right.waitTicks) return right.waitTicks - left.waitTicks;
  if (left.remainingRouteCells !== right.remainingRouteCells) {
    return left.remainingRouteCells - right.remainingRouteCells;
  }
  if (left.tripStartedTick !== right.tripStartedTick) {
    return left.tripStartedTick - right.tripStartedTick;
  }
  return compareCitizenIds(left.citizenId, right.citizenId);
}

function compareProposals(left: MovementProposal, right: MovementProposal): number {
  return compareCitizenIds(left.citizenId, right.citizenId);
}

function compareBlocked(left: MovementBlockedProposal, right: MovementBlockedProposal): number {
  return compareCitizenIds(left.citizenId, right.citizenId);
}

function compareSwaps(left: MovementSwapPair, right: MovementSwapPair): number {
  return compareStrings(left.key, right.key);
}

export function movementPairKey(leftId: string, rightId: string): string {
  return compareCitizenIds(leftId, rightId) <= 0 ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
}

function copyCandidatePosition(candidate: MovementCandidate, index: number): GridPosition {
  const position = candidate.route[index];
  return position === undefined ? copyPosition(candidate.position) : copyPosition(position);
}

/**
 * Runs one bounded deterministic A* replan with temporary dynamic blockers.
 * The blocker set is never retained by this helper or by the pathfinder.
 */
export function replanMovementRoute(input: MovementReplanInput): MovementReplanResult {
  const temporaryBlocked = new Set(input.temporaryBlocked);
  temporaryBlocked.delete(coordinateKey(input.start));
  temporaryBlocked.delete(coordinateKey(input.goal));
  const result = findGridPathDetailed(
    {
      chunkSize: input.chunkSize,
      activeChunks: input.activeChunks,
      isWalkable: (position) =>
        input.isWalkable(position) && !temporaryBlocked.has(coordinateKey(position)),
      maxNodes: input.maxNodes,
    },
    input.start,
    input.goal,
  );
  const path = result.path.map(copyPosition);
  const previousRemainingRoute = input.currentRoute.slice(input.currentRouteIndex);
  return {
    status: result.status,
    path,
    routeIndex: result.status === 'found' ? 0 : input.currentRouteIndex,
    routeChanged:
      result.status === 'found' &&
      (previousRemainingRoute.length !== path.length ||
        previousRemainingRoute.some((position, index) => {
          const other = path[index];
          return other === undefined || !positionsEqual(position, other);
        })),
    nodesExpanded: result.nodesExpanded,
    chunksTouched: result.chunksTouched,
  };
}

/** Builds exactly one deterministic next-cell proposal for each candidate. */
export function buildMovementProposals(input: MovementProposalInput): readonly MovementProposal[] {
  const candidates = [...input.candidates].sort((left, right) =>
    compareCitizenIds(left.id, right.id),
  );
  const proposals: MovementProposal[] = [];
  for (const candidate of candidates) {
    const current = copyPosition(candidate.position);
    const nextIndex = candidate.routeIndex + 1;
    const next = copyCandidatePosition(candidate, nextIndex);
    const routePosition = candidate.route[candidate.routeIndex];
    const routeStateValid =
      Number.isSafeInteger(candidate.routeIndex) &&
      candidate.routeIndex >= 0 &&
      candidate.routeIndex < candidate.route.length &&
      candidate.route.length > 0 &&
      routePosition !== undefined &&
      positionsEqual(routePosition, candidate.position) &&
      nextIndex < candidate.route.length;
    const scalarStateValid =
      Number.isSafeInteger(candidate.waitTicks) &&
      candidate.waitTicks >= 0 &&
      Number.isSafeInteger(candidate.tripStartedTick) &&
      candidate.tripStartedTick >= 0;
    const valid =
      routeStateValid &&
      scalarStateValid &&
      adjacent(current, next) &&
      input.isActive(current) &&
      input.isActive(next) &&
      input.isWalkable(current) &&
      input.isWalkable(next);
    proposals.push({
      citizenId: candidate.id,
      from: current,
      to: next,
      waitTicks: candidate.waitTicks,
      remainingRouteCells: Math.max(0, candidate.route.length - nextIndex - 1),
      tripStartedTick: candidate.tripStartedTick,
      valid,
      ...(valid ? {} : { blockReason: 'invalid' as const }),
    });
  }
  return proposals;
}

function chooseTargetWinners(
  proposals: readonly MovementProposal[],
): ReadonlyMap<string, MovementProposal> {
  const byTarget = new Map<string, MovementProposal[]>();
  for (const proposal of proposals) {
    if (!proposal.valid) continue;
    const targetKey = coordinateKey(proposal.to);
    const group = byTarget.get(targetKey);
    if (group === undefined) byTarget.set(targetKey, [proposal]);
    else group.push(proposal);
  }
  const winners = new Map<string, MovementProposal>();
  for (const group of byTarget.values()) {
    group.sort(compareMovementProposals);
    const winner = group[0];
    if (winner !== undefined) winners.set(winner.citizenId, winner);
  }
  return winners;
}

function buildDirectSwapPairs(proposals: readonly MovementProposal[]): readonly MovementSwapPair[] {
  const winners = chooseTargetWinners(proposals);
  const byFrom = new Map<string, MovementProposal>();
  for (const proposal of winners.values()) byFrom.set(coordinateKey(proposal.from), proposal);
  const swaps = new Map<string, MovementSwapPair>();
  for (const proposal of winners.values()) {
    const other = byFrom.get(coordinateKey(proposal.to));
    if (other === undefined || !positionsEqual(other.to, proposal.from)) continue;
    const key = movementPairKey(proposal.citizenId, other.citizenId);
    if (swaps.has(key)) continue;
    const leftFirst = compareCitizenIds(proposal.citizenId, other.citizenId) <= 0;
    const left = leftFirst ? proposal : other;
    const right = leftFirst ? other : proposal;
    swaps.set(key, {
      key,
      leftId: left.citizenId,
      rightId: right.citizenId,
      leftFrom: copyPosition(left.from),
      leftTo: copyPosition(left.to),
      rightFrom: copyPosition(right.from),
      rightTo: copyPosition(right.to),
    });
  }
  return [...swaps.values()].sort(compareSwaps);
}

/**
 * Returns direct two-citizen head-on pairs after same-target priority has been
 * applied. The result is suitable for deterministic deadlock tracking.
 */
export function findDirectMovementSwapPairs(
  proposals: readonly MovementProposal[],
): readonly MovementSwapPair[] {
  return buildDirectSwapPairs(proposals);
}

function blockedFromProposal(
  proposal: MovementProposal,
  reason: MovementBlockReason,
): MovementBlockedProposal {
  return {
    citizenId: proposal.citizenId,
    from: copyPosition(proposal.from),
    to: copyPosition(proposal.to),
    reason,
  };
}

/**
 * Resolves all proposals against the occupancy captured at the beginning of
 * the tick. No caller-visible state is mutated by this function.
 */
export function resolveMovementReservations(input: MovementResolutionInput): MovementResolution {
  const proposals = [...input.proposals].sort(compareProposals);
  const validProposals = proposals.filter((proposal) => proposal.valid);
  const winners = chooseTargetWinners(validProposals);
  const blocked: MovementBlockedProposal[] = proposals
    .filter((proposal) => !proposal.valid)
    .map((proposal) => blockedFromProposal(proposal, 'invalid'));
  let targetConflicts = 0;
  for (const proposal of validProposals) {
    if (!winners.has(proposal.citizenId)) {
      blocked.push(blockedFromProposal(proposal, 'target-conflict'));
      targetConflicts += 1;
    }
  }

  const directSwapPairs = buildDirectSwapPairs(validProposals);
  const emergencySwapPairs = input.emergencySwapPairs ?? new Set<string>();
  const status = new Map<string, boolean>();
  const blockedReason = new Map<string, MovementBlockReason>();
  const acceptedCycleLength = new Map<string, number>();
  const acceptedEmergency = new Set<string>();
  const countedEmergencyPairs = new Set<string>();
  const ordinarySwapKeys = new Set<string>();
  let cyclesCommitted = 0;
  let ordinarySwapsRejected = 0;
  let emergencySwaps = 0;

  const setRejected = (citizenId: string, reason: MovementBlockReason): false => {
    status.set(citizenId, false);
    blockedReason.set(citizenId, reason);
    return false;
  };

  const setAccepted = (citizenId: string, cycleLength: number, emergency: boolean): true => {
    status.set(citizenId, true);
    acceptedCycleLength.set(citizenId, cycleLength);
    if (emergency) acceptedEmergency.add(citizenId);
    return true;
  };

  const resolve = (citizenId: string, stack: readonly string[]): boolean => {
    const known = status.get(citizenId);
    if (known !== undefined) return known;
    const proposal = winners.get(citizenId);
    if (proposal === undefined) return setRejected(citizenId, 'dependency');
    const occupantId = input.movingOccupancy.get(coordinateKey(proposal.to));
    if (occupantId === undefined || occupantId === citizenId) {
      setAccepted(citizenId, 1, false);
      return true;
    }
    if (!winners.has(occupantId)) return setRejected(citizenId, 'dependency');
    const cycleStart = stack.indexOf(occupantId);
    if (cycleStart >= 0) {
      const cycle = [...stack.slice(cycleStart), citizenId];
      const uniqueCycle = [...new Set(cycle)];
      if (uniqueCycle.length === 2) {
        const firstCycleId = uniqueCycle[0];
        const secondCycleId = uniqueCycle[1];
        if (firstCycleId === undefined || secondCycleId === undefined) {
          throw new Error('Movement cycle was unexpectedly sparse.');
        }
        const pairKey = movementPairKey(firstCycleId, secondCycleId);
        const emergency = emergencySwapPairs.has(pairKey);
        if (emergency) {
          for (const id of uniqueCycle) setAccepted(id, 2, true);
          if (!countedEmergencyPairs.has(pairKey)) {
            emergencySwaps += 1;
            countedEmergencyPairs.add(pairKey);
          }
          return true;
        }
        for (const id of uniqueCycle) setRejected(id, 'ordinary-swap');
        if (!ordinarySwapKeys.has(pairKey)) {
          ordinarySwapKeys.add(pairKey);
          ordinarySwapsRejected += 1;
        }
        return false;
      }
      if (uniqueCycle.length >= 3) {
        for (const id of uniqueCycle) setAccepted(id, uniqueCycle.length, false);
        cyclesCommitted += 1;
        return true;
      }
    }
    if (!resolve(occupantId, [...stack, citizenId])) {
      if (status.get(citizenId) === false) return false;
      return setRejected(citizenId, 'dependency');
    }
    setAccepted(citizenId, acceptedCycleLength.get(occupantId) ?? 1, false);
    return true;
  };

  for (const proposal of winners.values()) resolve(proposal.citizenId, [proposal.citizenId]);

  const accepted: MovementMove[] = [];
  for (const proposal of winners.values()) {
    if (status.get(proposal.citizenId) !== true) continue;
    accepted.push({
      citizenId: proposal.citizenId,
      from: copyPosition(proposal.from),
      to: copyPosition(proposal.to),
      cycleLength: acceptedCycleLength.get(proposal.citizenId) ?? 1,
      emergencySwap: acceptedEmergency.has(proposal.citizenId),
    });
  }
  accepted.sort((left, right) => compareCitizenIds(left.citizenId, right.citizenId));

  for (const proposal of winners.values()) {
    if (status.get(proposal.citizenId) !== false) continue;
    const reason = blockedReason.get(proposal.citizenId) ?? 'dependency';
    blocked.push(blockedFromProposal(proposal, reason));
  }
  blocked.sort(compareBlocked);

  const dependencyBlocks = blocked.filter(({ reason }) => reason === 'dependency').length;
  return {
    accepted,
    blocked,
    targetConflicts,
    dependencyBlocks,
    cyclesCommitted,
    ordinarySwapsRejected,
    emergencySwaps,
    directSwapPairs,
  };
}
