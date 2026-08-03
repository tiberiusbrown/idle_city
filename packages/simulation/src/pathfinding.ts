import { createGridPosition, type GridPosition } from '@idle-city/shared';

export type AStarSearchStatus = 'searching' | 'found' | 'no-path';
export type AStarAdvanceStatus = 'found' | 'no-path' | 'budget-exhausted';

export interface AStarSearchOptions {
  readonly start: GridPosition;
  readonly goal: GridPosition;
  readonly isWalkable?: (position: GridPosition) => boolean;
}

export interface AStarAdvanceResult {
  readonly status: AStarAdvanceStatus;
  readonly expansions: number;
  readonly path: readonly GridPosition[] | null;
}

export interface AStarSearch {
  readonly start: GridPosition;
  readonly goal: GridPosition;
  readonly status: AStarSearchStatus;
  readonly totalExpansions: number;
  advance(maxExpansions: number): AStarAdvanceResult;
}

interface SearchNode {
  readonly key: string;
  readonly position: GridPosition;
  g: number;
  readonly h: number;
  parentKey: string | null;
  closed: boolean;
}

interface OpenEntry {
  readonly key: string;
  readonly g: number;
  readonly f: number;
  readonly h: number;
  readonly insertionSequence: number;
}

const NEIGHBOR_DELTAS: readonly [number, number][] = Object.freeze([
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
]);

function positionKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function manhattanDistance(left: GridPosition, right: GridPosition): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function compareOpenEntries(left: OpenEntry, right: OpenEntry): number {
  return (
    left.f - right.f ||
    left.h - right.h ||
    left.insertionSequence - right.insertionSequence ||
    left.key.localeCompare(right.key)
  );
}

function tryNeighbor(
  position: GridPosition,
  delta: readonly [number, number],
): GridPosition | null {
  const x = position.x + delta[0];
  const y = position.y + delta[1];
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  return createGridPosition(x, y);
}

class OpenSet {
  private readonly entries: OpenEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(entry: OpenEntry): void {
    this.entries.push(entry);
    this.bubbleUp(this.entries.length - 1);
  }

  pop(): OpenEntry | undefined {
    const first = this.entries[0];
    if (first === undefined) return undefined;

    const last = this.entries.pop();
    if (last !== undefined && this.entries.length > 0) {
      this.entries[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const entry = this.entries[index];
      const parent = this.entries[parentIndex];
      if (entry === undefined || parent === undefined || compareOpenEntries(entry, parent) >= 0) {
        return;
      }
      this.entries[index] = parent;
      this.entries[parentIndex] = entry;
      index = parentIndex;
    }
  }

  private bubbleDown(startIndex: number): void {
    let index = startIndex;
    while (index < this.entries.length) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;
      const current = this.entries[index];
      const left = this.entries[leftIndex];
      const right = this.entries[rightIndex];

      if (current === undefined) return;
      if (left !== undefined && compareOpenEntries(left, current) < 0) {
        smallestIndex = leftIndex;
      }
      const smallest = this.entries[smallestIndex];
      if (
        right !== undefined &&
        smallest !== undefined &&
        compareOpenEntries(right, smallest) < 0
      ) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === index) return;

      const replacement = this.entries[smallestIndex];
      if (replacement === undefined) return;
      this.entries[index] = replacement;
      this.entries[smallestIndex] = current;
      index = smallestIndex;
    }
  }
}

class ResumableAStarSearch implements AStarSearch {
  readonly start: GridPosition;
  readonly goal: GridPosition;
  private readonly isWalkable: (position: GridPosition) => boolean;
  private readonly nodes = new Map<string, SearchNode>();
  private readonly openSet = new OpenSet();
  private insertionSequence = 0;
  private currentStatus: AStarSearchStatus = 'searching';
  private foundPath: readonly GridPosition[] | null = null;
  private expansionCount = 0;

  constructor(options: AStarSearchOptions) {
    this.start = createGridPosition(options.start.x, options.start.y);
    this.goal = createGridPosition(options.goal.x, options.goal.y);
    this.isWalkable = options.isWalkable ?? (() => true);

    if (!this.isWalkable(this.start) || !this.isWalkable(this.goal)) {
      this.currentStatus = 'no-path';
      return;
    }

    if (this.start.x === this.goal.x && this.start.y === this.goal.y) {
      this.currentStatus = 'found';
      this.foundPath = Object.freeze([]);
      return;
    }

    const startKey = positionKey(this.start);
    const startNode: SearchNode = {
      key: startKey,
      position: this.start,
      g: 0,
      h: manhattanDistance(this.start, this.goal),
      parentKey: null,
      closed: false,
    };
    this.nodes.set(startKey, startNode);
    this.pushOpen(startNode);
  }

  get status(): AStarSearchStatus {
    return this.currentStatus;
  }

  get totalExpansions(): number {
    return this.expansionCount;
  }

  advance(maxExpansions: number): AStarAdvanceResult {
    if (!Number.isSafeInteger(maxExpansions) || maxExpansions <= 0) {
      throw new Error(
        `A* expansion budget must be a positive safe integer; received ${String(maxExpansions)}.`,
      );
    }

    if (this.currentStatus === 'found') {
      return { status: 'found', expansions: 0, path: this.foundPath };
    }
    if (this.currentStatus === 'no-path') {
      return { status: 'no-path', expansions: 0, path: null };
    }

    let expansions = 0;
    while (expansions < maxExpansions) {
      const current = this.takeNextOpenNode();
      if (current === undefined) {
        this.currentStatus = 'no-path';
        return { status: 'no-path', expansions, path: null };
      }

      current.closed = true;
      expansions += 1;
      this.expansionCount += 1;

      if (current.key === positionKey(this.goal)) {
        this.currentStatus = 'found';
        this.foundPath = this.reconstructPath(current);
        return { status: 'found', expansions, path: this.foundPath };
      }

      for (const delta of NEIGHBOR_DELTAS) {
        const neighbor = tryNeighbor(current.position, delta);
        if (neighbor === null || !this.isWalkable(neighbor)) continue;

        const neighborKey = positionKey(neighbor);
        const tentativeG = current.g + 1;
        const existing = this.nodes.get(neighborKey);
        if (existing !== undefined && tentativeG >= existing.g) continue;

        const node: SearchNode = existing ?? {
          key: neighborKey,
          position: neighbor,
          g: tentativeG,
          h: manhattanDistance(neighbor, this.goal),
          parentKey: current.key,
          closed: false,
        };
        node.g = tentativeG;
        node.parentKey = current.key;
        node.closed = false;
        this.nodes.set(neighborKey, node);
        this.pushOpen(node);
      }

      if (!this.hasLiveOpenEntries()) {
        this.currentStatus = 'no-path';
        return { status: 'no-path', expansions, path: null };
      }
    }

    return { status: 'budget-exhausted', expansions, path: null };
  }

  private pushOpen(node: SearchNode): void {
    this.openSet.push({
      key: node.key,
      g: node.g,
      f: node.g + node.h,
      h: node.h,
      insertionSequence: this.insertionSequence,
    });
    this.insertionSequence += 1;
  }

  private takeNextOpenNode(): SearchNode | undefined {
    while (this.openSet.size > 0) {
      const entry = this.openSet.pop();
      if (entry === undefined) return undefined;
      const node = this.nodes.get(entry.key);
      if (node === undefined || node.closed || node.g !== entry.g) continue;
      return node;
    }
    return undefined;
  }

  private hasLiveOpenEntries(): boolean {
    if (this.openSet.size === 0) return false;
    return true;
  }

  private reconstructPath(goalNode: SearchNode): readonly GridPosition[] {
    const path: GridPosition[] = [];
    let current: SearchNode | undefined = goalNode;
    while (current !== undefined && current.key !== positionKey(this.start)) {
      path.push(current.position);
      const parentKey: string | null = current.parentKey;
      current = parentKey === null ? undefined : this.nodes.get(parentKey);
    }
    path.reverse();
    return Object.freeze(path);
  }
}

export function createAStarSearch(options: AStarSearchOptions): AStarSearch {
  return new ResumableAStarSearch(options);
}
