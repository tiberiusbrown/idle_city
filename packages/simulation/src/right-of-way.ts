import type { GridPosition } from '@idle-city/shared';

export type CorridorOrientation = 'horizontal' | 'vertical';

export interface CorridorPair {
  readonly first: GridPosition;
  readonly second: GridPosition;
}

export interface TwoCellConnectorInput {
  readonly startPairs: readonly CorridorPair[];
  readonly goalPairs: readonly CorridorPair[];
  readonly isActive: (position: GridPosition) => boolean;
  /** Existing ROW and the two endpoint envelopes should return true here. */
  readonly isCellAvailable: (position: GridPosition) => boolean;
  readonly maxExpansions: number;
}

export type TwoCellConnectorStatus = 'found' | 'no-path' | 'budget-exhausted';

export interface TwoCellConnectorResult {
  readonly status: TwoCellConnectorStatus;
  readonly pairs: readonly CorridorPair[];
  readonly cells: readonly GridPosition[];
  readonly expansions: number;
  readonly turns: number;
}

const directions: readonly GridPosition[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function comparePositions(left: GridPosition, right: GridPosition): number {
  return left.y === right.y ? left.x - right.x : left.y - right.y;
}

function positionKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function pairKey(pair: CorridorPair): string {
  return `${positionKey(pair.first)}|${positionKey(pair.second)}`;
}

function normalizePair(left: GridPosition, right: GridPosition): CorridorPair | undefined {
  if (Math.abs(left.x - right.x) + Math.abs(left.y - right.y) !== 1) return undefined;
  return comparePositions(left, right) <= 0
    ? { first: { ...left }, second: { ...right } }
    : { first: { ...right }, second: { ...left } };
}

function orientation(pair: CorridorPair): CorridorOrientation {
  return pair.first.y === pair.second.y ? 'horizontal' : 'vertical';
}

function orientationOrder(value: CorridorOrientation): number {
  return value === 'horizontal' ? 0 : 1;
}

function comparePairs(left: CorridorPair, right: CorridorPair): number {
  return (
    comparePositions(left.first, right.first) ||
    comparePositions(left.second, right.second) ||
    orientationOrder(orientation(left)) - orientationOrder(orientation(right))
  );
}

function pairCellsKey(pair: CorridorPair): string {
  return `${positionKey(pair.first)}|${positionKey(pair.second)}`;
}

function pairContains(pair: CorridorPair, position: GridPosition): boolean {
  return (
    positionKey(pair.first) === positionKey(position) ||
    positionKey(pair.second) === positionKey(position)
  );
}

function pairBoundsFitTurn(left: CorridorPair, right: CorridorPair): boolean {
  const cells = [left.first, left.second, right.first, right.second];
  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  return maxX - minX <= 1 && maxY - minY <= 1;
}

function addPair(
  result: Map<string, CorridorPair>,
  first: GridPosition,
  second: GridPosition,
): void {
  const pair = normalizePair(first, second);
  if (pair === undefined) return;
  result.set(pairKey(pair), pair);
}

/** Enumerates adjacent pairs in stable row-major order. */
export function enumerateAdjacentCorridorPairs(cells: readonly GridPosition[]): CorridorPair[] {
  const orderedCells = [...cells].map((cell) => ({ ...cell })).sort(comparePositions);
  const available = new Set(orderedCells.map(positionKey));
  const result = new Map<string, CorridorPair>();
  for (const cell of orderedCells) {
    for (const direction of directions) {
      const neighbor = { x: cell.x + direction.x, y: cell.y + direction.y };
      if (!available.has(positionKey(neighbor))) continue;
      addPair(result, cell, neighbor);
    }
  }
  return [...result.values()].sort(comparePairs);
}

function connectorNeighbors(pair: CorridorPair): CorridorPair[] {
  const result = new Map<string, CorridorPair>();
  const pairOrientation = orientation(pair);
  const straightDirections: readonly GridPosition[] =
    pairOrientation === 'horizontal'
      ? [
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ]
      : [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
        ];
  for (const direction of straightDirections) {
    addPair(
      result,
      { x: pair.first.x + direction.x, y: pair.first.y + direction.y },
      { x: pair.second.x + direction.x, y: pair.second.y + direction.y },
    );
  }

  // A turn is a pair sharing one cell with the old pair inside one 2x2
  // block. This is the only transition that changes orientation.
  for (const shared of [pair.first, pair.second]) {
    for (const direction of directions) {
      const candidate = normalizePair(shared, {
        x: shared.x + direction.x,
        y: shared.y + direction.y,
      });
      if (candidate === undefined || !pairBoundsFitTurn(pair, candidate)) continue;
      if (pairKey(candidate) === pairKey(pair)) continue;
      if (!pairContains(pair, candidate.first) && !pairContains(pair, candidate.second)) continue;
      result.set(pairKey(candidate), candidate);
    }
  }
  return [...result.values()].sort(comparePairs);
}

function pairDistance(left: CorridorPair, right: CorridorPair): number {
  return Math.min(
    Math.abs(left.first.x - right.first.x) + Math.abs(left.first.y - right.first.y),
    Math.abs(left.first.x - right.second.x) + Math.abs(left.first.y - right.second.y),
    Math.abs(left.second.x - right.first.x) + Math.abs(left.second.y - right.first.y),
    Math.abs(left.second.x - right.second.x) + Math.abs(left.second.y - right.second.y),
  );
}

function heuristic(pair: CorridorPair, goals: readonly CorridorPair[]): number {
  let result = Number.POSITIVE_INFINITY;
  for (const goal of goals) result = Math.min(result, pairDistance(pair, goal));
  return result === Number.POSITIVE_INFINITY ? 0 : result;
}

interface OpenNode {
  readonly pair: CorridorPair;
  readonly key: string;
  readonly g: number;
  readonly turns: number;
  readonly previous: string | undefined;
  readonly sequence: number;
}

function compareOpenNodes(left: OpenNode, right: OpenNode, goals: readonly CorridorPair[]): number {
  const leftF = left.g + heuristic(left.pair, goals);
  const rightF = right.g + heuristic(right.pair, goals);
  if (leftF !== rightF) return leftF - rightF;
  if (left.g !== right.g) return left.g - right.g;
  if (left.turns !== right.turns) return left.turns - right.turns;
  const pairOrder = comparePairs(left.pair, right.pair);
  if (pairOrder !== 0) return pairOrder;
  return left.sequence - right.sequence;
}

function copyPair(pair: CorridorPair): CorridorPair {
  return { first: { ...pair.first }, second: { ...pair.second } };
}

function reconstructPath(goalKey: string, nodes: ReadonlyMap<string, OpenNode>): CorridorPair[] {
  const result: CorridorPair[] = [];
  let currentKey: string | undefined = goalKey;
  while (currentKey !== undefined) {
    const node = nodes.get(currentKey);
    if (node === undefined) throw new Error(`Missing corridor predecessor ${currentKey}.`);
    result.push(copyPair(node.pair));
    currentKey = node.previous;
  }
  result.reverse();
  return result;
}

function resultFor(
  status: TwoCellConnectorStatus,
  pairs: readonly CorridorPair[],
  expansions: number,
  turns: number,
): TwoCellConnectorResult {
  const cells = new Map<string, GridPosition>();
  for (const pair of pairs) {
    cells.set(positionKey(pair.first), { ...pair.first });
    cells.set(positionKey(pair.second), { ...pair.second });
  }
  return {
    status,
    pairs: pairs.map(copyPair),
    cells: [...cells.values()].sort(comparePositions),
    expansions,
    turns,
  };
}

/**
 * Deterministic two-cell-wide corridor search. A state is a pair of adjacent
 * cells. Straight transitions translate the pair perpendicular to its width;
 * turns are the four-cell 2x2 transitions described above. Existing ROW is
 * reusable because the caller's availability predicate can accept it.
 */
export function findTwoCellConnector(input: TwoCellConnectorInput): TwoCellConnectorResult {
  if (!Number.isSafeInteger(input.maxExpansions) || input.maxExpansions < 1) {
    throw new Error(
      `maxExpansions must be a positive safe integer; received ${String(input.maxExpansions)}.`,
    );
  }
  const starts = input.startPairs.map(copyPair).sort(comparePairs);
  const goals = input.goalPairs.map(copyPair).sort(comparePairs);
  if (starts.length === 0 || goals.length === 0) return resultFor('no-path', [], 0, 0);
  const goalKeys = new Set(goals.map(pairKey));
  const open: OpenNode[] = [];
  const nodes = new Map<string, OpenNode>();
  const best = new Map<string, { g: number; turns: number; sequence: number }>();
  let sequence = 0;
  for (const pair of starts) {
    if (
      ![pair.first, pair.second].every(
        (cell) => input.isActive(cell) && input.isCellAvailable(cell),
      )
    ) {
      continue;
    }
    const key = pairKey(pair);
    const node: OpenNode = { pair, key, g: 0, turns: 0, previous: undefined, sequence };
    sequence += 1;
    open.push(node);
    nodes.set(key, node);
    best.set(key, { g: 0, turns: 0, sequence: node.sequence });
  }
  let expansions = 0;
  while (open.length > 0) {
    open.sort((left, right) => compareOpenNodes(left, right, goals));
    const current = open.shift();
    if (current === undefined) break;
    const currentBest = best.get(current.key);
    if (
      currentBest?.g !== current.g ||
      currentBest.turns !== current.turns ||
      currentBest.sequence !== current.sequence
    ) {
      continue;
    }
    if (expansions >= input.maxExpansions) {
      return resultFor('budget-exhausted', [], expansions, 0);
    }
    expansions += 1;
    if (goalKeys.has(current.key)) {
      const pairs = reconstructPath(current.key, nodes);
      return resultFor('found', pairs, expansions, current.turns);
    }
    for (const neighbor of connectorNeighbors(current.pair)) {
      if (
        ![neighbor.first, neighbor.second].every(
          (cell) => input.isActive(cell) && input.isCellAvailable(cell),
        )
      ) {
        continue;
      }
      const neighborKey = pairKey(neighbor);
      const turns = current.turns + (orientation(current.pair) === orientation(neighbor) ? 0 : 1);
      const g = current.g + 1;
      const previousBest = best.get(neighborKey);
      if (
        previousBest !== undefined &&
        (previousBest.g < g || (previousBest.g === g && previousBest.turns <= turns))
      ) {
        continue;
      }
      const node: OpenNode = {
        pair: neighbor,
        key: neighborKey,
        g,
        turns,
        previous: current.key,
        sequence,
      };
      sequence += 1;
      best.set(neighborKey, { g, turns, sequence: node.sequence });
      nodes.set(neighborKey, node);
      open.push(node);
    }
  }
  return resultFor('no-path', [], expansions, 0);
}

export function corridorPairKey(pair: CorridorPair): string {
  return pairCellsKey(normalizePair(pair.first, pair.second) ?? pair);
}

export function corridorPairOrientation(pair: CorridorPair): CorridorOrientation {
  return orientation(pair);
}
