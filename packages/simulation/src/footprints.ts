import type { GridPosition, GridRect } from '@idle-city/shared';
import type { BuildingType } from './types';

export const BUILDING_FOOTPRINTS = {
  home: { width: 3, height: 3 },
  workplace: { width: 5, height: 5 },
} as const satisfies Readonly<Record<BuildingType, { width: number; height: number }>>;

const directions: readonly GridPosition[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function coordinateKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function comparePositions(left: GridPosition, right: GridPosition): number {
  return left.y === right.y ? left.x - right.x : left.y - right.y;
}

function validateRect(rect: GridRect): void {
  if (
    !Number.isSafeInteger(rect.x) ||
    !Number.isSafeInteger(rect.y) ||
    !Number.isSafeInteger(rect.width) ||
    !Number.isSafeInteger(rect.height) ||
    rect.width < 1 ||
    rect.height < 1
  ) {
    throw new Error('Grid rectangles require safe integer origin and positive dimensions.');
  }
}

export function buildingFootprint(origin: GridPosition, type: BuildingType): GridRect {
  if (!Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) {
    throw new Error('Building footprint origins must use safe integer coordinates.');
  }
  const size = BUILDING_FOOTPRINTS[type];
  return { x: origin.x, y: origin.y, width: size.width, height: size.height };
}

/** Occupied cells are derived in stable row-major (y, then x) order. */
export function footprintCells(rect: GridRect): GridPosition[] {
  validateRect(rect);
  const cells: GridPosition[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) cells.push({ x, y });
  }
  return cells;
}

export function isInsideFootprint(position: GridPosition, rect: GridRect): boolean {
  validateRect(rect);
  return (
    position.x >= rect.x &&
    position.y >= rect.y &&
    position.x < rect.x + rect.width &&
    position.y < rect.y + rect.height
  );
}

export function isExteriorEntrance(position: GridPosition, rect: GridRect): boolean {
  validateRect(rect);
  if (isInsideFootprint(position, rect)) return false;
  const adjacent = directions.some((direction) =>
    isInsideFootprint({ x: position.x - direction.x, y: position.y - direction.y }, rect),
  );
  return adjacent;
}

/**
 * Candidates are exterior perimeter cells sorted in row-major order. Sorting
 * after de-duplication makes the ordering independent of which perimeter
 * side produced a candidate at a corner.
 */
export function exteriorEntranceCandidates(rect: GridRect): GridPosition[] {
  validateRect(rect);
  const candidates = new Map<string, GridPosition>();
  for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    candidates.set(coordinateKey({ x, y: rect.y - 1 }), { x, y: rect.y - 1 });
    candidates.set(coordinateKey({ x, y: rect.y + rect.height }), {
      x,
      y: rect.y + rect.height,
    });
  }
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    candidates.set(coordinateKey({ x: rect.x - 1, y }), { x: rect.x - 1, y });
    candidates.set(coordinateKey({ x: rect.x + rect.width, y }), {
      x: rect.x + rect.width,
      y,
    });
  }
  return [...candidates.values()].sort(comparePositions);
}

export interface EntranceSelectionOptions {
  readonly isActive: (position: GridPosition) => boolean;
  readonly isWalkable: (position: GridPosition) => boolean;
  readonly isReachable?: (position: GridPosition) => boolean;
}

/** Selects the first active, walkable, locally reachable exterior candidate. */
export function selectExteriorEntrance(
  rect: GridRect,
  options: EntranceSelectionOptions,
): GridPosition {
  for (const candidate of exteriorEntranceCandidates(rect)) {
    if (!options.isActive(candidate) || !options.isWalkable(candidate)) continue;
    if (options.isReachable !== undefined && !options.isReachable(candidate)) continue;
    const hasWalkableNeighbor = directions.some((direction) => {
      const neighbor = { x: candidate.x + direction.x, y: candidate.y + direction.y };
      return !isInsideFootprint(neighbor, rect) && options.isWalkable(neighbor);
    });
    if (hasWalkableNeighbor) return { ...candidate };
  }
  throw new Error(
    `No active reachable exterior entrance exists for footprint ${String(rect.x)},${String(rect.y)}.`,
  );
}
