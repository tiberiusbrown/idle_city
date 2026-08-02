import type { GridPosition } from '@idle-city/shared';
import type { TrafficEdgeSnapshot } from './types';

/** The default number of logical ticks retained by movement telemetry. */
export const DEFAULT_TRAFFIC_HISTORY_WINDOW_TICKS = 256;

export interface TrafficEdgeIdentity {
  readonly key: string;
  readonly a: GridPosition;
  readonly b: GridPosition;
}

export interface TrafficTelemetryCounters {
  readonly activeEdges: number;
  readonly traversalEventsRecorded: number;
  readonly expiredTraversalEvents: number;
  readonly expiredBuckets: number;
  readonly peakActiveEdges: number;
}

export interface TrafficTelemetryOptions {
  readonly historyWindowTicks?: number;
}

interface MutableTrafficEdge extends TrafficEdgeIdentity {
  aToB: number;
  bToA: number;
  total: number;
}

interface TrafficBucketContribution {
  aToB: number;
  bToA: number;
  total: number;
}

interface TrafficBucket {
  readonly tick: number;
  readonly edges: Map<string, TrafficBucketContribution>;
  eventCount: number;
}

function copyPosition(position: GridPosition): GridPosition {
  return { x: position.x, y: position.y };
}

function comparePositions(left: GridPosition, right: GridPosition): number {
  return left.y === right.y ? left.x - right.x : left.y - right.y;
}

function isSafeGridPosition(position: GridPosition): boolean {
  return Number.isSafeInteger(position.x) && Number.isSafeInteger(position.y);
}

function isOrthogonallyAdjacent(left: GridPosition, right: GridPosition): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function validateHistoryWindowTicks(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      `Traffic history window must be a positive safe integer; received ${String(value)}.`,
    );
  }
  return value;
}

/**
 * Returns the canonical identity for one physical orthogonal edge.
 * Endpoints are ordered by `(y, x)` and the key uses `x,y|x,y` formatting.
 */
export function canonicalTrafficEdge(left: GridPosition, right: GridPosition): TrafficEdgeIdentity {
  if (
    !isSafeGridPosition(left) ||
    !isSafeGridPosition(right) ||
    !isOrthogonallyAdjacent(left, right)
  ) {
    throw new Error('Traffic edge endpoints must be safe integer orthogonal neighbors.');
  }
  const [a, b] = comparePositions(left, right) <= 0 ? [left, right] : [right, left];
  const canonicalA = copyPosition(a);
  const canonicalB = copyPosition(b);
  return {
    key: `${String(canonicalA.x)},${String(canonicalA.y)}|${String(canonicalB.x)},${String(canonicalB.y)}`,
    a: canonicalA,
    b: canonicalB,
  };
}

/** A non-throwing seam for validation code that wants to reject invalid edges. */
export function tryCanonicalTrafficEdge(
  left: GridPosition,
  right: GridPosition,
): TrafficEdgeIdentity | undefined {
  if (
    !isSafeGridPosition(left) ||
    !isSafeGridPosition(right) ||
    !isOrthogonallyAdjacent(left, right)
  ) {
    return undefined;
  }
  return canonicalTrafficEdge(left, right);
}

export function trafficEdgeKey(left: GridPosition, right: GridPosition): string {
  return canonicalTrafficEdge(left, right).key;
}

function compareTrafficEdges(left: TrafficEdgeIdentity, right: TrafficEdgeIdentity): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/**
 * Stores only the current rolling window of successfully committed movement.
 * Ring buckets contain edge deltas for one logical tick; snapshots never expose
 * those buckets.
 */
export interface TrafficTelemetry {
  readonly historyWindowTicks: number;
  advanceToTick(tick: number): void;
  recordCommittedMove(from: GridPosition, to: GridPosition, tick?: number): void;
  getSnapshot(): readonly TrafficEdgeSnapshot[];
  getCounters(): TrafficTelemetryCounters;
}

export function createTrafficTelemetry(
  options: TrafficTelemetryOptions | number = {},
): TrafficTelemetry {
  const requestedWindow = typeof options === 'number' ? options : options.historyWindowTicks;
  const historyWindowTicks = validateHistoryWindowTicks(
    requestedWindow ?? DEFAULT_TRAFFIC_HISTORY_WINDOW_TICKS,
  );
  const buckets: (TrafficBucket | undefined)[] = Array.from({ length: historyWindowTicks });
  const edges = new Map<string, MutableTrafficEdge>();
  let currentTick = 0;
  let traversalEventsRecorded = 0;
  let expiredTraversalEvents = 0;
  let expiredBuckets = 0;
  let peakActiveEdges = 0;

  const expireBucket = (tick: number): void => {
    if (tick < 0) return;
    const bucketIndex = tick % historyWindowTicks;
    const bucket = buckets[bucketIndex];
    if (bucket?.tick !== tick) return;
    buckets[bucketIndex] = undefined;
    for (const [key, contribution] of bucket.edges) {
      const edge = edges.get(key);
      if (edge === undefined) {
        throw new Error(`Traffic edge ${key} is missing while expiring a bucket.`);
      }
      edge.aToB -= contribution.aToB;
      edge.bToA -= contribution.bToA;
      edge.total -= contribution.total;
      if (edge.aToB < 0 || edge.bToA < 0 || edge.total < 0) {
        throw new Error(`Traffic edge ${key} became negative while expiring a bucket.`);
      }
      if (edge.total === 0) edges.delete(key);
    }
    expiredTraversalEvents += bucket.eventCount;
    expiredBuckets += 1;
  };

  const expireThrough = (lastExpiredTick: number): void => {
    if (lastExpiredTick < 0) return;
    const firstRelevantTick = Math.max(0, currentTick - historyWindowTicks + 1);
    if (lastExpiredTick < firstRelevantTick) return;
    const relevantTickCount = lastExpiredTick - firstRelevantTick + 1;
    if (relevantTickCount > historyWindowTicks) {
      for (const bucket of buckets) {
        if (bucket?.tick !== undefined && bucket.tick <= lastExpiredTick) {
          expireBucket(bucket.tick);
        }
      }
      return;
    }
    for (let tick = firstRelevantTick; tick <= lastExpiredTick; tick += 1) {
      expireBucket(tick);
    }
  };

  const advanceToTick = (tick: number): void => {
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new Error(
        `Traffic tick must be a non-negative safe integer; received ${String(tick)}.`,
      );
    }
    if (tick < currentTick) {
      throw new Error(
        `Traffic tick cannot move backwards from ${String(currentTick)} to ${String(tick)}.`,
      );
    }
    if (tick === currentTick) return;
    expireThrough(tick - historyWindowTicks);
    currentTick = tick;
  };

  const recordCommittedMove = (from: GridPosition, to: GridPosition, tick = currentTick): void => {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick !== currentTick) {
      throw new Error(
        `Traffic moves must be recorded at the current logical tick ${String(currentTick)}.`,
      );
    }
    const identity = canonicalTrafficEdge(from, to);
    const bucketIndex = tick % historyWindowTicks;
    let bucket = buckets[bucketIndex];
    if (bucket !== undefined && bucket.tick !== tick) {
      expireBucket(bucket.tick);
      bucket = undefined;
    }
    if (bucket === undefined) {
      bucket = { tick, edges: new Map(), eventCount: 0 };
      buckets[bucketIndex] = bucket;
    }

    let edge = edges.get(identity.key);
    if (edge === undefined) {
      edge = { ...identity, aToB: 0, bToA: 0, total: 0 };
      edges.set(identity.key, edge);
      peakActiveEdges = Math.max(peakActiveEdges, edges.size);
    }
    let contribution = bucket.edges.get(identity.key);
    if (contribution === undefined) {
      contribution = { aToB: 0, bToA: 0, total: 0 };
      bucket.edges.set(identity.key, contribution);
    }
    const fromIsA = from.x === identity.a.x && from.y === identity.a.y;
    if (fromIsA) {
      edge.aToB += 1;
      contribution.aToB += 1;
    } else {
      edge.bToA += 1;
      contribution.bToA += 1;
    }
    edge.total += 1;
    contribution.total += 1;
    bucket.eventCount += 1;
    traversalEventsRecorded += 1;
  };

  const getSnapshot = (): readonly TrafficEdgeSnapshot[] =>
    [...edges.values()].sort(compareTrafficEdges).map((edge) => ({
      key: edge.key,
      a: copyPosition(edge.a),
      b: copyPosition(edge.b),
      aToB: edge.aToB,
      bToA: edge.bToA,
      total: edge.total,
    }));

  return {
    historyWindowTicks,
    advanceToTick,
    recordCommittedMove,
    getSnapshot,
    getCounters(): TrafficTelemetryCounters {
      return {
        activeEdges: edges.size,
        traversalEventsRecorded,
        expiredTraversalEvents,
        expiredBuckets,
        peakActiveEdges,
      };
    },
  };
}
