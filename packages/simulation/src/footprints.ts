import type { GridPosition, GridRect } from '@idle-city/shared';
import type { BuildingType } from './types';

export const BUILDING_FOOTPRINTS = {
  home: { width: 3, height: 3 },
  workplace: { width: 5, height: 5 },
  service: { width: 4, height: 4 },
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

/** Occupied cells are derived in stable y-then-x order. */
export function footprintCells(rect: GridRect): GridPosition[] {
  validateRect(rect);
  const cells: GridPosition[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) cells.push({ x, y });
  }
  return cells;
}

/**
 * The protected clearance zone is the one-cell ring around a building
 * footprint. Its interior is intentionally not returned by the clearance-zone cells.
 */
export function buildingClearanceZone(rect: GridRect): GridRect {
  validateRect(rect);
  return { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 };
}

/** Clearance-zone ring cells are returned in stable y-then-x order. */
export function buildingClearanceZoneCells(rect: GridRect): GridPosition[] {
  const clearanceZone = buildingClearanceZone(rect);
  const cells: GridPosition[] = [];
  for (let y = clearanceZone.y; y < clearanceZone.y + clearanceZone.height; y += 1) {
    for (let x = clearanceZone.x; x < clearanceZone.x + clearanceZone.width; x += 1) {
      if (isInsideFootprint({ x, y }, rect)) continue;
      cells.push({ x, y });
    }
  }
  return cells;
}

/** All orthogonally adjacent exterior cells, excluding diagonal corners. */
export function completedBuildingAccessCells(rect: GridRect): GridPosition[] {
  validateRect(rect);
  const cells: GridPosition[] = [];
  for (let y = rect.y - 1; y <= rect.y + rect.height; y += 1) {
    for (let x = rect.x - 1; x <= rect.x + rect.width; x += 1) {
      if (isInsideFootprint({ x, y }, rect)) continue;
      const adjacent = directions.some((direction) =>
        isInsideFootprint({ x: x - direction.x, y: y - direction.y }, rect),
      );
      if (adjacent) cells.push({ x, y });
    }
  }
  return cells;
}

export interface StagingCellOptions {
  readonly isActive: (position: GridPosition) => boolean;
  readonly isWalkable: (position: GridPosition) => boolean;
}

export interface ProjectStagingSelectionOptions extends StagingCellOptions {
  readonly entrance: GridPosition;
  readonly reserved?: ReadonlySet<string>;
  readonly count?: number;
}

function ringPerimeterIndex(position: GridPosition, rect: GridRect): number {
  const left = rect.x - 1;
  const top = rect.y - 1;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (position.y === top) return position.x - left;
  if (position.x === right) return rect.width + 1 + (position.y - top - 1);
  if (position.y === bottom) return rect.width + 1 + rect.height + (right - position.x);
  if (position.x === left) {
    return rect.width + 1 + rect.height + rect.width + (bottom - position.y - 1);
  }
  throw new Error('Perimeter distance requires a cell on the clearance zone.');
}

function perimeterDistance(left: GridPosition, right: GridPosition, rect: GridRect): number {
  const perimeterLength = 2 * (rect.width + rect.height + 2);
  const difference = Math.abs(ringPerimeterIndex(left, rect) - ringPerimeterIndex(right, rect));
  return Math.min(difference, perimeterLength - difference);
}

function positionKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

/**
 * A staging cell is an active, walkable clearance-zone cell with at least one
 * active, walkable cell beyond the clearance zone.
 */
export function stagingCapableClearanceZoneCells(
  rect: GridRect,
  options: StagingCellOptions,
): GridPosition[] {
  const clearanceZone = buildingClearanceZone(rect);
  const candidates = buildingClearanceZoneCells(rect);
  return candidates.filter((candidate) => {
    if (!options.isActive(candidate) || !options.isWalkable(candidate)) return false;
    return directions.some((direction) => {
      const neighbor = { x: candidate.x + direction.x, y: candidate.y + direction.y };
      if (isInsideFootprint(neighbor, rect)) return false;
      if (
        neighbor.x >= clearanceZone.x &&
        neighbor.x < clearanceZone.x + clearanceZone.width &&
        neighbor.y >= clearanceZone.y &&
        neighbor.y < clearanceZone.y + clearanceZone.height
      ) {
        return false;
      }
      return options.isActive(neighbor) && options.isWalkable(neighbor);
    });
  });
}

/**
 * Selects the exact stable staging set used by an active project. Selection
 * itself never mutates spatial state.
 */
export function selectProjectStagingCells(
  rect: GridRect,
  options: ProjectStagingSelectionOptions,
): GridPosition[] {
  validateRect(rect);
  if (!isExteriorEntrance(options.entrance, rect)) {
    throw new Error('Project staging selection requires an exterior entrance.');
  }
  const reserved = options.reserved ?? new Set<string>();
  const count = options.count ?? 3;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(
      `Project staging count must be a positive safe integer; received ${String(count)}.`,
    );
  }
  const candidates = stagingCapableClearanceZoneCells(rect, options)
    .filter((candidate) => !reserved.has(positionKey(candidate)))
    .sort((left, right) => {
      const leftIsEntrance = left.x === options.entrance.x && left.y === options.entrance.y;
      const rightIsEntrance = right.x === options.entrance.x && right.y === options.entrance.y;
      if (leftIsEntrance !== rightIsEntrance) return leftIsEntrance ? -1 : 1;
      const distanceDifference =
        perimeterDistance(left, options.entrance, rect) -
        perimeterDistance(right, options.entrance, rect);
      if (distanceDifference !== 0) return distanceDifference;
      return comparePositions(left, right);
    });
  return candidates.slice(0, count).map((candidate) => ({ ...candidate }));
}

export const selectStagingCells = selectProjectStagingCells;

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
 * Candidates are exterior perimeter cells sorted in stable y-then-x order. Sorting
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
