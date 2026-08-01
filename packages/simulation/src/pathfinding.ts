import type { GridPosition } from '@idle-city/shared';

const directions: readonly GridPosition[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function key(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

export interface PathGrid {
  readonly width: number;
  readonly height: number;
  readonly isWalkable?: (position: GridPosition) => boolean;
}

export function findGridPath(
  grid: PathGrid,
  start: GridPosition,
  goal: GridPosition,
): GridPosition[] {
  const inBounds = (position: GridPosition): boolean =>
    position.x >= 0 && position.y >= 0 && position.x < grid.width && position.y < grid.height;
  const isWalkable = grid.isWalkable ?? (() => true);
  if (!inBounds(start) || !inBounds(goal))
    throw new Error('Path endpoints must be inside the grid.');
  if (!isWalkable(start) || !isWalkable(goal)) throw new Error('Path endpoints must be walkable.');

  const queue: GridPosition[] = [{ ...start }];
  const parents = new Map<string, GridPosition | undefined>([[key(start), undefined]]);
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (current === undefined) throw new Error('Pathfinding queue became inconsistent.');
    if (current.x === goal.x && current.y === goal.y) break;
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (!inBounds(next) || !isWalkable(next) || parents.has(key(next))) continue;
      parents.set(key(next), current);
      queue.push(next);
    }
  }

  if (!parents.has(key(goal))) throw new Error(`No path from ${key(start)} to ${key(goal)}.`);
  const reversed: GridPosition[] = [];
  let current: GridPosition | undefined = { ...goal };
  while (current !== undefined) {
    reversed.push(current);
    current = parents.get(key(current));
  }
  return reversed.reverse();
}
