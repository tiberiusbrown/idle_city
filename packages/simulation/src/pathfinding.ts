import type { ChunkCoordinate, GridPosition } from '@idle-city/shared';
import { stableHash } from '@idle-city/shared';
import { chunkCoordinateForPosition, chunkKey, compareChunks, validateChunkSize } from './chunks';

const defaultMovementCost = 10;
const baseDirections: readonly GridPosition[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
/**
 * Four deterministic rotations of the base order. Profiles only influence
 * insertion order among equal-cost A* alternatives; edge costs stay uniform
 * for ordinary trip planning, so a profile can never lengthen a shortest path.
 */
const defaultSearchBudget = 100_000;

function key(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function manhattanDistance(left: GridPosition, right: GridPosition): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function comparePositions(left: GridPosition, right: GridPosition): number {
  return left.y === right.y ? left.x - right.x : left.y - right.y;
}

export interface PathGrid {
  /** The chunk size is required when active chunk storage is used. */
  readonly chunkSize?: number;
  readonly activeChunks?: readonly ChunkCoordinate[];
  readonly isChunkActive?: (chunk: ChunkCoordinate) => boolean;
  readonly isWalkable?: (position: GridPosition) => boolean;
  /** Legacy finite-grid bounds remain supported for focused unit tests. */
  readonly width?: number;
  readonly height?: number;
  readonly maxNodes?: number;
}

export interface PathSearchOptions {
  readonly maxNodes?: number;
  /** Base cost for one orthogonal edge. */
  readonly movementCost?: number;
  /** Cost multiplier used by the admissible Manhattan heuristic. */
  readonly heuristicCost?: number;
  /** Optional deterministic additional edge cost used by recovery searches. */
  readonly edgeCost?: (from: GridPosition, to: GridPosition) => number;
}

export type PathSearchStatus = 'found' | 'no-path' | 'budget-exhausted';

export interface PathSearchResult {
  readonly status: PathSearchStatus;
  readonly path: readonly GridPosition[];
  readonly nodesExpanded: number;
  readonly chunksTouched: number;
}

export interface MultiPortalPathResult extends PathSearchResult {
  readonly source: GridPosition | null;
  readonly goal: GridPosition | null;
}

/** One bounded uniform-cost search over multiple source and destination portals. */
export function findGridPathBetweenSets(
  grid: PathGrid,
  sourcesInput: readonly GridPosition[],
  goalsInput: readonly GridPosition[],
  tieKey: string,
  options: PathSearchOptions = {},
): MultiPortalPathResult {
  const sources = [...new Map(sourcesInput.map((p) => [key(p), { x: p.x, y: p.y }])).values()].sort(
    comparePositions,
  );
  const goals = [...new Map(goalsInput.map((p) => [key(p), { x: p.x, y: p.y }])).values()].sort(
    comparePositions,
  );
  if (!sources.length || !goals.length)
    return {
      status: 'no-path',
      path: [],
      source: null,
      goal: null,
      nodesExpanded: 0,
      chunksTouched: 0,
    };
  const chunks = activeChunkSet(grid);
  const validSourceKeys = new Set(
    sources
      .filter((p) => isActivePosition(grid, p, chunks) && grid.isWalkable?.(p) !== false)
      .map(key),
  );
  const validGoalKeys = new Set(
    goals
      .filter((p) => isActivePosition(grid, p, chunks) && grid.isWalkable?.(p) !== false)
      .map(key),
  );
  sources.splice(0, sources.length, ...sources.filter((p) => validSourceKeys.has(key(p))));
  goals.splice(0, goals.length, ...goals.filter((p) => validGoalKeys.has(key(p))));
  if (!sources.length || !goals.length)
    return {
      status: 'no-path',
      path: [],
      source: null,
      goal: null,
      nodesExpanded: 0,
      chunksTouched: 0,
    };
  const goalKeys = new Set(goals.map(key));
  const queue: GridPosition[] = [];
  const distance = new Map<string, number>();
  const memberships = new Map<string, Set<string>>();
  for (const source of sources) {
    const sourceKey = key(source);
    queue.push(source);
    distance.set(sourceKey, 0);
    memberships.set(sourceKey, new Set([sourceKey]));
  }
  let head = 0;
  let expanded = 0;
  const touchedChunks = new Set<string>();
  let best = Number.POSITIVE_INFINITY;
  const candidates: { source: GridPosition; goal: GridPosition }[] = [];
  const budget = validateBudget(options.maxNodes ?? grid.maxNodes);
  while (head < queue.length && expanded < budget) {
    const current = queue[head++];
    if (current === undefined) throw new Error('Path queue unexpectedly ended.');
    const currentKey = key(current);
    const d = distance.get(currentKey);
    if (d === undefined) throw new Error(`Missing path distance for ${currentKey}.`);
    if (grid.chunkSize !== undefined)
      touchedChunks.add(chunkKey(chunkCoordinateForPosition(current, grid.chunkSize)));
    if (d > best) break;
    expanded += 1;
    if (goalKeys.has(currentKey)) {
      best = d;
      for (const sourceKey of memberships.get(currentKey) ?? []) {
        const p = sourceKey.split(',');
        candidates.push({ source: { x: Number(p[0]), y: Number(p[1]) }, goal: current });
      }
    }
    for (const direction of baseDirections) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const nextKey = key(next);
      if (!isActivePosition(grid, next, chunks) || grid.isWalkable?.(next) === false) continue;
      const incoming = memberships.get(currentKey) ?? new Set<string>();
      const existing = memberships.get(nextKey);
      if (existing === undefined) {
        distance.set(nextKey, d + 1);
        memberships.set(nextKey, new Set(incoming));
        queue.push(next);
      } else if (distance.get(nextKey) === d + 1)
        for (const sourceKey of incoming) existing.add(sourceKey);
    }
  }
  const queued = queue[head];
  const queuedDistance =
    queued === undefined ? Number.POSITIVE_INFINITY : distance.get(key(queued));
  const hasIncompleteBestLayer =
    expanded >= budget &&
    head < queue.length &&
    (queuedDistance ?? Number.POSITIVE_INFINITY) <= best;
  if (hasIncompleteBestLayer)
    return {
      status: 'budget-exhausted',
      path: [],
      source: null,
      goal: null,
      nodesExpanded: expanded,
      chunksTouched: touchedChunks.size,
    };
  if (!candidates.length)
    return {
      status: head >= queue.length ? 'no-path' : 'budget-exhausted',
      path: [],
      source: null,
      goal: null,
      nodesExpanded: expanded,
      chunksTouched: touchedChunks.size,
    };
  candidates.sort((a, b) => {
    const ah = stableHash(
      `${tieKey}|${String(a.source.x)},${String(a.source.y)}|${String(a.goal.x)},${String(a.goal.y)}`,
    );
    const bh = stableHash(
      `${tieKey}|${String(b.source.x)},${String(b.source.y)}|${String(b.goal.x)},${String(b.goal.y)}`,
    );
    return ah < bh
      ? -1
      : ah > bh
        ? 1
        : a.source.y - b.source.y ||
          a.source.x - b.source.x ||
          a.goal.y - b.goal.y ||
          a.goal.x - b.goal.x;
  });
  const selected = candidates[0];
  if (selected === undefined) throw new Error('Path candidate selection unexpectedly ended.');
  const path: GridPosition[] = [selected.goal];
  let cursor = selected.goal;
  while (key(cursor) !== key(selected.source)) {
    const d = distance.get(key(cursor));
    if (d === undefined) throw new Error(`Missing path distance for ${key(cursor)}.`);
    const previous = baseDirections
      .map((v) => ({ x: cursor.x - v.x, y: cursor.y - v.y }))
      .filter(
        (p) =>
          distance.get(key(p)) === d - 1 &&
          (memberships.get(key(p))?.has(key(selected.source)) ?? false),
      )
      .sort(comparePositions)[0];
    if (previous === undefined) break;
    path.push(previous);
    cursor = previous;
  }
  path.reverse();
  if (
    path.length === 0 ||
    key(path[0] ?? selected.source) !== key(selected.source) ||
    key(path.at(-1) ?? selected.goal) !== key(selected.goal) ||
    path.length - 1 !== best
  ) {
    throw new Error('Multi-portal path reconstruction invariant failed.');
  }
  for (let i = 1; i < path.length; i += 1) {
    const previous = path[i - 1];
    const current = path[i];
    if (previous === undefined || current === undefined)
      throw new Error('Multi-portal path index unexpectedly ended.');
    if (Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) !== 1)
      throw new Error('Multi-portal path contains a non-adjacent step.');
  }
  return {
    status: 'found',
    path,
    source: selected.source,
    goal: selected.goal,
    nodesExpanded: expanded,
    chunksTouched: touchedChunks.size,
  };
}

interface OpenEntry {
  readonly position: GridPosition;
  readonly key: string;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly sequence: number;
}

class MinHeap {
  private readonly entries: OpenEntry[] = [];

  public get length(): number {
    return this.entries.length;
  }

  public push(entry: OpenEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentEntry = this.entries[parent];
      if (parentEntry === undefined || compareEntries(parentEntry, entry) <= 0) break;
      this.entries[index] = parentEntry;
      index = parent;
    }
    this.entries[index] = entry;
  }

  public pop(): OpenEntry | undefined {
    const first = this.entries[0];
    if (first === undefined) return undefined;
    const last = this.entries.pop();
    if (last !== undefined && this.entries.length > 0) {
      let index = 0;
      while (index < this.entries.length) {
        const left = index * 2 + 1;
        const right = left + 1;
        const leftEntry = this.entries[left];
        const rightEntry = this.entries[right];
        if (leftEntry === undefined) break;
        let childIndex = left;
        let child = leftEntry;
        if (rightEntry !== undefined && compareEntries(rightEntry, leftEntry) < 0) {
          childIndex = right;
          child = rightEntry;
        }
        if (compareEntries(last, child) <= 0) break;
        this.entries[index] = child;
        index = childIndex;
      }
      this.entries[index] = last;
    }
    return first;
  }
}

function compareEntries(left: OpenEntry, right: OpenEntry): number {
  if (left.f !== right.f) return left.f - right.f;
  if (left.h !== right.h) return left.h - right.h;
  // Sequence reflects the selected direction order. It is consulted only
  // after equal f/h values, so it cannot trade a longer path for a shorter one.
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  const positionOrder = comparePositions(left.position, right.position);
  if (positionOrder !== 0) return positionOrder;
  return 0;
}

function validateEndpoint(position: GridPosition): void {
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y)) {
    throw new Error('Path endpoints must use safe integer coordinates.');
  }
}

function validateBudget(value: number | undefined): number {
  const budget = value ?? defaultSearchBudget;
  if (!Number.isSafeInteger(budget) || budget < 1) {
    throw new Error(
      `Path search budget must be a positive safe integer; received ${String(budget)}.`,
    );
  }
  return budget;
}

function validateCost(name: string, value: number | undefined, fallback: number): number {
  const cost = value ?? fallback;
  if (!Number.isSafeInteger(cost) || cost < 1) {
    throw new Error(`${name} must be a positive safe integer; received ${String(cost)}.`);
  }
  return cost;
}

function activeChunkSet(grid: PathGrid): ReadonlySet<string> | undefined {
  if (grid.activeChunks === undefined) return undefined;
  const result = new Set<string>();
  for (const chunk of grid.activeChunks) result.add(chunkKey(chunk));
  return result;
}

function isInsideLegacyBounds(grid: PathGrid, position: GridPosition): boolean {
  if (grid.width === undefined && grid.height === undefined) return true;
  if (grid.width === undefined || grid.height === undefined) {
    throw new Error('Path grids must provide both width and height when using finite bounds.');
  }
  return position.x >= 0 && position.y >= 0 && position.x < grid.width && position.y < grid.height;
}

function isActivePosition(
  grid: PathGrid,
  position: GridPosition,
  chunks: ReadonlySet<string> | undefined,
): boolean {
  if (!isInsideLegacyBounds(grid, position)) return false;
  if (grid.chunkSize === undefined && chunks !== undefined) {
    throw new Error('Chunk-aware path grids must provide chunkSize.');
  }
  if (grid.chunkSize === undefined) {
    if (grid.isChunkActive !== undefined) {
      throw new Error('Chunk-aware path grids must provide chunkSize.');
    }
    return true;
  }
  const chunk = chunkCoordinateForPosition(position, grid.chunkSize);
  if (chunks !== undefined) return chunks.has(chunkKey(chunk));
  return grid.isChunkActive?.(chunk) ?? true;
}

function reconstructPath(
  start: GridPosition,
  goal: GridPosition,
  parents: ReadonlyMap<string, GridPosition | undefined>,
): GridPosition[] {
  const reversed: GridPosition[] = [];
  let current: GridPosition | undefined = { ...goal };
  while (current !== undefined) {
    reversed.push({ ...current });
    current = parents.get(key(current));
  }
  if (reversed.at(-1)?.x !== start.x || reversed.at(-1)?.y !== start.y) {
    throw new Error('Path parent chain did not terminate at its start.');
  }
  return reversed.reverse();
}

export function findGridPathDetailed(
  grid: PathGrid,
  start: GridPosition,
  goal: GridPosition,
  options: PathSearchOptions = {},
): PathSearchResult {
  validateEndpoint(start);
  validateEndpoint(goal);
  const chunkSize = grid.chunkSize;
  if (chunkSize !== undefined) validateChunkSize(chunkSize);
  const chunks = activeChunkSet(grid);
  const isActive = (position: GridPosition): boolean => isActivePosition(grid, position, chunks);
  const isWalkable = grid.isWalkable ?? (() => true);
  if (!isActive(start) || !isActive(goal) || !isWalkable(start) || !isWalkable(goal)) {
    throw new Error('Path endpoints must be inside active walkable space.');
  }

  const budget = validateBudget(options.maxNodes ?? grid.maxNodes);
  const baseCost = validateCost('Path movement cost', options.movementCost, defaultMovementCost);
  const heuristicCost = validateCost('Path heuristic cost', options.heuristicCost, baseCost);
  const directions = baseDirections;
  const edgeCost = options.edgeCost ?? (() => 0);
  const open = new MinHeap();
  const startKey = key(start);
  const goalKey = key(goal);
  const parents = new Map<string, GridPosition | undefined>([[startKey, undefined]]);
  const bestG = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();
  const touchedChunks = new Set<string>();
  let sequence = 0;
  const startHeuristic = manhattanDistance(start, goal) * heuristicCost;
  open.push({
    position: { ...start },
    key: startKey,
    g: 0,
    h: startHeuristic,
    f: startHeuristic,
    sequence,
  });

  let nodesExpanded = 0;
  while (open.length > 0) {
    if (nodesExpanded >= budget) {
      return {
        status: 'budget-exhausted',
        path: [],
        nodesExpanded,
        chunksTouched: touchedChunks.size,
      };
    }
    const current = open.pop();
    if (current === undefined) break;
    const knownG = bestG.get(current.key);
    if (knownG === undefined || knownG !== current.g || closed.has(current.key)) continue;
    closed.add(current.key);
    nodesExpanded += 1;
    if (chunkSize !== undefined) {
      touchedChunks.add(chunkKey(chunkCoordinateForPosition(current.position, chunkSize)));
    }
    if (current.key === goalKey) {
      return {
        status: 'found',
        path: reconstructPath(start, goal, parents),
        nodesExpanded,
        chunksTouched: touchedChunks.size,
      };
    }

    for (const direction of directions) {
      const next = {
        x: current.position.x + direction.x,
        y: current.position.y + direction.y,
      };
      const nextKey = key(next);
      if (!isActive(next) || !isWalkable(next) || closed.has(nextKey)) continue;
      const additionalCost = edgeCost(current.position, next);
      if (!Number.isSafeInteger(additionalCost) || additionalCost < 0) {
        throw new Error(
          `Path edge cost must be a finite non-negative safe integer; received ${String(additionalCost)}.`,
        );
      }
      const nextG = current.g + baseCost + additionalCost;
      const previousG = bestG.get(nextKey);
      if (previousG !== undefined && nextG >= previousG) continue;
      const heuristic = manhattanDistance(next, goal) * heuristicCost;
      bestG.set(nextKey, nextG);
      parents.set(nextKey, { ...current.position });
      sequence += 1;
      open.push({
        position: next,
        key: nextKey,
        g: nextG,
        h: heuristic,
        f: nextG + heuristic,
        sequence,
      });
    }
  }

  return {
    status: 'no-path',
    path: [],
    nodesExpanded,
    chunksTouched: touchedChunks.size,
  };
}

export function findGridPath(
  grid: PathGrid,
  start: GridPosition,
  goal: GridPosition,
  options: PathSearchOptions = {},
): GridPosition[] {
  const result = findGridPathDetailed(grid, start, goal, options);
  if (result.status === 'budget-exhausted') {
    throw new Error(`Path search budget exhausted after ${String(result.nodesExpanded)} nodes.`);
  }
  if (result.status === 'no-path') {
    throw new Error(`No path from ${key(start)} to ${key(goal)}.`);
  }
  return result.path.map((position) => ({ ...position }));
}

export function pathChunks(path: readonly GridPosition[], chunkSize: number): ChunkCoordinate[] {
  validateChunkSize(chunkSize);
  const keys = new Map<string, ChunkCoordinate>();
  for (const position of path) {
    const chunk = chunkCoordinateForPosition(position, chunkSize);
    keys.set(chunkKey(chunk), chunk);
  }
  return [...keys.values()].sort(compareChunks).map((chunk) => ({ ...chunk }));
}
