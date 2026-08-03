import { stableHash, type BuildingId, type CitizenId, type GridPosition } from '@idle-city/shared';
import type { BuildingInstance } from './buildings';

export interface BuildingPassabilityOptions {
  readonly buildings: readonly BuildingInstance[];
  readonly sourceBuildingId?: BuildingId | null;
  readonly destinationBuildingId?: BuildingId | null;
  /**
   * Authorization is deliberately a callback. Construction assignment is not
   * implemented yet, but the next migration step can provide its authoritative
   * project-membership check without changing A* or movement code.
   */
  readonly isAuthorizedForIncompleteBuilding?: (building: BuildingInstance) => boolean;
}

export interface BuildingDestinationCellOptions {
  readonly physicalCells: readonly GridPosition[];
  readonly citizenId: CitizenId;
  readonly buildingId: BuildingId;
  readonly tripSequence: number;
  readonly purpose: string;
  /** Either spelling is accepted so callers can mirror their domain vocabulary. */
  readonly worldSeed?: number;
  readonly seed?: number;
}

export interface BuildingTrip {
  readonly sourceBuildingId: BuildingId | null;
  readonly destinationBuildingId: BuildingId;
  readonly destinationCell: GridPosition;
  readonly tripSequence: number;
}

export interface BuildingTripOptions {
  readonly building: Pick<BuildingInstance, 'id' | 'physicalCells'>;
  readonly sourceBuildingId?: BuildingId | null;
  readonly citizenId: CitizenId;
  readonly tripSequence: number;
  readonly purpose?: string;
  readonly worldSeed?: number;
  readonly seed?: number;
}

function positionKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function comparePositions(left: GridPosition, right: GridPosition): number {
  return left.y - right.y || left.x - right.x;
}

/**
 * Returns whether a building's physical cells may be traversed by this route.
 * The route source and destination are the only ordinary exceptions. Incomplete
 * projects still require the authorization callback even when they are a route
 * endpoint.
 */
export function isBuildingPassable(
  building: BuildingInstance,
  options: Omit<BuildingPassabilityOptions, 'buildings' | 'startPosition'>,
): boolean {
  const isRouteBuilding =
    building.id === (options.sourceBuildingId ?? null) ||
    building.id === (options.destinationBuildingId ?? null);
  if (!isRouteBuilding) return false;

  if (
    building.state.kind === 'incomplete' &&
    !(options.isAuthorizedForIncompleteBuilding?.(building) ?? false)
  ) {
    return false;
  }

  return true;
}

/**
 * Creates the callback supplied to A*. Empty cells are walkable; every physical
 * building cell is checked against the route exceptions above.
 */
export function createBuildingPassabilityCallback(
  options: BuildingPassabilityOptions,
): (position: GridPosition) => boolean {
  const buildingByCell = new Map<string, BuildingInstance>();
  for (const building of options.buildings) {
    for (const cell of building.physicalCells) {
      const key = positionKey(cell);
      if (buildingByCell.has(key)) {
        throw new Error(`Overlapping building physical cells cannot be navigated at ${key}.`);
      }
      buildingByCell.set(key, building);
    }
  }

  return (position: GridPosition): boolean => {
    const building = buildingByCell.get(positionKey(position));
    if (building === undefined) return true;

    return isBuildingPassable(building, options);
  };
}

/**
 * Selects an interior cell without consuming shared random state. The sorted
 * cell list makes the result independent of geometry array insertion order.
 */
export function selectBuildingDestinationCell(
  options: BuildingDestinationCellOptions,
): GridPosition {
  if (options.physicalCells.length === 0) {
    throw new Error('A building destination requires a non-empty physical footprint.');
  }
  if (!Number.isSafeInteger(options.tripSequence) || options.tripSequence < 0) {
    throw new Error(
      `Building trip sequences must be nonnegative safe integers; received ${String(options.tripSequence)}.`,
    );
  }

  const worldSeed = options.worldSeed ?? options.seed;
  if (worldSeed === undefined || !Number.isSafeInteger(worldSeed)) {
    throw new Error(`Building destination selection requires a safe integer world seed.`);
  }

  const cells = [...options.physicalCells]
    .map((cell) => ({ x: cell.x, y: cell.y }))
    .sort(comparePositions);
  const hash = stableHash({
    worldSeed,
    citizenId: options.citizenId,
    buildingId: options.buildingId,
    tripSequence: options.tripSequence,
    purpose: options.purpose,
  });
  const selectedIndex = Number.parseInt(hash, 16) % cells.length;
  const selected = cells[selectedIndex];
  if (selected === undefined) throw new Error('Building destination selection was out of range.');
  return Object.freeze(selected);
}

/** Builds route metadata for a future goal selector without mutating state. */
export function createBuildingTrip(options: BuildingTripOptions): BuildingTrip {
  const destinationCell = selectBuildingDestinationCell({
    physicalCells: options.building.physicalCells,
    citizenId: options.citizenId,
    buildingId: options.building.id,
    tripSequence: options.tripSequence,
    purpose: options.purpose ?? 'building-destination',
    ...(options.worldSeed === undefined ? {} : { worldSeed: options.worldSeed }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });
  return Object.freeze({
    sourceBuildingId: options.sourceBuildingId ?? null,
    destinationBuildingId: options.building.id,
    destinationCell,
    tripSequence: options.tripSequence,
  });
}

/** Timer arithmetic shared by generic activities and future activity kinds. */
export function decrementBuildingActivityTicks(ticksRemaining: number): number {
  if (!Number.isSafeInteger(ticksRemaining) || ticksRemaining < 0) {
    throw new Error(
      `Building activity timers must be nonnegative safe integers; received ${String(ticksRemaining)}.`,
    );
  }
  return Math.max(0, ticksRemaining - 1);
}

/** Stable-purpose convenience for internal activity wandering. */
export function selectInternalBuildingDestinationCell(
  options: Omit<BuildingDestinationCellOptions, 'purpose'> & { readonly purpose?: string },
): GridPosition {
  return selectBuildingDestinationCell({
    ...options,
    purpose: options.purpose ?? 'building-internal-wandering',
  });
}
