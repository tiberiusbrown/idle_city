import {
  createBuildingId,
  createGridPosition,
  createGridRect,
  createZoneId,
  type BuildingId,
  type CitizenId,
  type GridPosition,
  type GridRect,
  type ZoneId,
} from '@idle-city/shared';
import type { ZoneType } from './index';

/** A canonical local cell set. Cells are offsets from a building origin. */
export interface BuildingShape {
  readonly cells: readonly GridPosition[];
}

/** Absolute geometry reserved by one building instance. */
export interface BuildingGeometry {
  readonly physicalCells: readonly GridPosition[];
  readonly exclusionCells: readonly GridPosition[];
}

export type BuildingTransform =
  | 'identity'
  | 'rotate-90'
  | 'rotate-180'
  | 'rotate-270'
  | 'reflect'
  | 'reflect-rotate-90'
  | 'reflect-rotate-180'
  | 'reflect-rotate-270';

/** Stable dihedral transform order. Duplicate geometries are removed per shape. */
export const BUILDING_TRANSFORM_ORDER: readonly BuildingTransform[] = Object.freeze([
  'identity',
  'rotate-90',
  'rotate-180',
  'rotate-270',
  'reflect',
  'reflect-rotate-90',
  'reflect-rotate-180',
  'reflect-rotate-270',
]);

/** Alias emphasizing that this is the stable enumeration order. */
export const BUILDING_TRANSFORMS = BUILDING_TRANSFORM_ORDER;

export function isBuildingTransform(value: unknown): value is BuildingTransform {
  return BUILDING_TRANSFORM_ORDER.includes(value as BuildingTransform);
}

function comparePositions(left: GridPosition, right: GridPosition): number {
  return left.y - right.y || left.x - right.x;
}

function positionKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function copyCells(cells: readonly GridPosition[]): readonly GridPosition[] {
  const copied = cells.map((cell) => createGridPosition(cell.x, cell.y));
  copied.sort(comparePositions);
  return Object.freeze(copied);
}

/** Creates a canonical non-empty shape and rejects duplicate or unsafe cells. */
export function createBuildingShape(cells: readonly GridPosition[]): BuildingShape {
  if (cells.length === 0) throw new Error('Building shapes must contain at least one cell.');

  const copied = cells.map((cell) => createGridPosition(cell.x, cell.y));
  const keys = new Set<string>();
  for (const cell of copied) {
    const key = positionKey(cell);
    if (keys.has(key)) throw new Error(`Building shapes may not contain duplicate cell ${key}.`);
    keys.add(key);
  }

  copied.sort(comparePositions);
  return Object.freeze({ cells: Object.freeze(copied) });
}

/** Creates a rectangular local shape, including every cell in the rectangle. */
export function createRectangularBuildingShape(
  x: number,
  y: number,
  width: number,
  height: number,
): BuildingShape {
  const bounds = createGridRect(x, y, width, height);
  const cells: GridPosition[] = [];
  for (let cellY = bounds.y; cellY < bounds.y + bounds.height; cellY += 1) {
    for (let cellX = bounds.x; cellX < bounds.x + bounds.width; cellX += 1) {
      cells.push(createGridPosition(cellX, cellY));
    }
  }
  return createBuildingShape(cells);
}

/** Returns the tight local bounds of a canonical shape. */
export function getBuildingShapeBounds(shape: BuildingShape): GridRect {
  if (shape.cells.length === 0) throw new Error('Building shapes must contain at least one cell.');

  let minX = shape.cells[0]?.x ?? 0;
  let minY = shape.cells[0]?.y ?? 0;
  let maxX = minX;
  let maxY = minY;
  for (const cell of shape.cells) {
    if (cell.x < minX) minX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y > maxY) maxY = cell.y;
  }
  return createGridRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
}

interface TransformSpec {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly reflected: boolean;
}

const TRANSFORM_SPECS: Readonly<Record<BuildingTransform, TransformSpec>> = Object.freeze({
  identity: { rotation: 0, reflected: false },
  'rotate-90': { rotation: 90, reflected: false },
  'rotate-180': { rotation: 180, reflected: false },
  'rotate-270': { rotation: 270, reflected: false },
  reflect: { rotation: 0, reflected: true },
  'reflect-rotate-90': { rotation: 90, reflected: true },
  'reflect-rotate-180': { rotation: 180, reflected: true },
  'reflect-rotate-270': { rotation: 270, reflected: true },
});

function transformPosition(position: GridPosition, transform: BuildingTransform): GridPosition {
  const spec = TRANSFORM_SPECS[transform];
  const reflectedX = spec.reflected ? -position.x : position.x;
  let x: number;
  let y: number;
  switch (spec.rotation) {
    case 0:
      x = reflectedX;
      y = position.y;
      break;
    case 90:
      x = -position.y;
      y = reflectedX;
      break;
    case 180:
      x = -reflectedX;
      y = -position.y;
      break;
    case 270:
      x = position.y;
      y = -reflectedX;
      break;
  }
  return createGridPosition(x, y);
}

function normalizeCells(cells: readonly GridPosition[]): readonly GridPosition[] {
  if (cells.length === 0) throw new Error('Building geometry must contain at least one cell.');

  let minX = cells[0]?.x ?? 0;
  let minY = cells[0]?.y ?? 0;
  for (const cell of cells) {
    if (cell.x < minX) minX = cell.x;
    if (cell.y < minY) minY = cell.y;
  }

  return copyCells(
    cells.map((cell) => {
      const x = cell.x - minX;
      const y = cell.y - minY;
      return createGridPosition(x, y);
    }),
  );
}

function transformShapeCells(shape: BuildingShape, transform: BuildingTransform): GridPosition[] {
  return shape.cells.map((cell) => transformPosition(cell, transform));
}

function geometryKey(geometry: BuildingGeometry): string {
  const physicalKey = geometry.physicalCells.map(positionKey).join(';');
  const exclusionKey = geometry.exclusionCells.map(positionKey).join(';');
  return `${physicalKey}|${exclusionKey}`;
}

/**
 * Applies a transform in local space and normalizes the physical shape to start
 * at (0, 0). The same translation is applied to the exclusion shape so its
 * relationship with the physical shape remains authoritative.
 */
export function transformBuildingGeometry(
  physicalShape: BuildingShape,
  exclusionShape: BuildingShape,
  transform: BuildingTransform,
): BuildingGeometry {
  if (!isBuildingTransform(transform)) {
    throw new Error(`Unknown building transform ${String(transform)}.`);
  }

  const physical = transformShapeCells(physicalShape, transform);
  const exclusion = transformShapeCells(exclusionShape, transform);
  const normalizedPhysical = normalizeCells(physical);

  let physicalMinX = physical[0]?.x ?? 0;
  let physicalMinY = physical[0]?.y ?? 0;
  for (const cell of physical) {
    if (cell.x < physicalMinX) physicalMinX = cell.x;
    if (cell.y < physicalMinY) physicalMinY = cell.y;
  }

  const normalizedExclusion = copyCells(
    exclusion.map((cell) => {
      const x = cell.x - physicalMinX;
      const y = cell.y - physicalMinY;
      return createGridPosition(x, y);
    }),
  );

  return Object.freeze({
    physicalCells: normalizedPhysical,
    exclusionCells: normalizedExclusion,
  });
}

function translateCells(
  cells: readonly GridPosition[],
  origin: GridPosition,
): readonly GridPosition[] {
  return copyCells(
    cells.map((cell) => {
      const x = origin.x + cell.x;
      const y = origin.y + cell.y;
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
        throw new Error('Building geometry exceeded the safe signed grid range.');
      }
      return createGridPosition(x, y);
    }),
  );
}

/** Translates already transformed local geometry to an absolute origin. */
export function translateBuildingGeometry(
  geometry: BuildingGeometry,
  origin: GridPosition,
): BuildingGeometry {
  if (!Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) {
    throw new Error('Building origins must use safe integer coordinates.');
  }
  return Object.freeze({
    physicalCells: translateCells(geometry.physicalCells, origin),
    exclusionCells: translateCells(geometry.exclusionCells, origin),
  });
}

/** Derives absolute geometry from an archetype, origin, and supported transform. */
export function getBuildingGeometry(
  archetype: BuildingArchetype,
  origin: GridPosition,
  transform: BuildingTransform,
): BuildingGeometry {
  if (!archetype.supportedTransforms.includes(transform)) {
    throw new Error(`Transform ${transform} is not supported by ${archetype.id}.`);
  }
  return translateBuildingGeometry(
    transformBuildingGeometry(archetype.physicalShape, archetype.exclusionShape, transform),
    origin,
  );
}

/** Returns unique transformed geometry in the stable transform order. */
export function enumerateUniqueBuildingTransforms(
  physicalShape: BuildingShape,
  exclusionShape: BuildingShape = physicalShape,
): readonly BuildingTransform[] {
  const seenGeometry = new Set<string>();
  const transforms: BuildingTransform[] = [];
  for (const transform of BUILDING_TRANSFORM_ORDER) {
    const geometry = transformBuildingGeometry(physicalShape, exclusionShape, transform);
    const key = geometryKey(geometry);
    if (seenGeometry.has(key)) continue;
    seenGeometry.add(key);
    transforms.push(transform);
  }
  return Object.freeze(transforms);
}

/** Convenience form for callers that only need one shape's unique transforms. */
export function enumerateUniqueShapeTransforms(shape: BuildingShape): readonly BuildingTransform[] {
  return enumerateUniqueBuildingTransforms(shape, shape);
}

/** Returns one normalized transformed shape without an absolute origin. */
export function transformBuildingShape(
  shape: BuildingShape,
  transform: BuildingTransform,
): BuildingShape {
  const geometry = transformBuildingGeometry(shape, shape, transform);
  return Object.freeze({ cells: geometry.physicalCells });
}

export interface BuildingCapacities {
  readonly residents: number;
  readonly workers: number;
  readonly visitors: number;
  readonly constructionWorkers: number;
}

export type BuildingArchetypeId = 'single-house' | 'small-shop' | 'small-park';
export type BuildingVisualKind = 'house' | 'shop' | 'park';

export interface BuildingArchetype {
  readonly id: BuildingArchetypeId;
  readonly zoneType: ZoneType;
  readonly physicalShape: BuildingShape;
  readonly exclusionShape: BuildingShape;
  readonly capacities: BuildingCapacities;
  readonly labor: number;
  readonly visualKind: BuildingVisualKind;
  readonly supportedTransforms: readonly BuildingTransform[];
}

function createBuildingArchetype(
  id: BuildingArchetypeId,
  zoneType: ZoneType,
  width: number,
  height: number,
  capacities: BuildingCapacities,
  labor: number,
  visualKind: BuildingVisualKind,
): BuildingArchetype {
  const physicalShape = createRectangularBuildingShape(0, 0, width, height);
  const exclusionShape = createRectangularBuildingShape(-1, -1, width + 2, height + 2);
  return Object.freeze({
    id,
    zoneType,
    physicalShape,
    exclusionShape,
    capacities: Object.freeze({ ...capacities }),
    labor,
    visualKind,
    supportedTransforms: enumerateUniqueBuildingTransforms(physicalShape, exclusionShape),
  });
}

export const SINGLE_HOUSE_ARCHETYPE = createBuildingArchetype(
  'single-house',
  'living',
  2,
  2,
  { residents: 1, workers: 0, visitors: 0, constructionWorkers: 1 },
  100,
  'house',
);

export const SMALL_SHOP_ARCHETYPE = createBuildingArchetype(
  'small-shop',
  'working',
  3,
  3,
  { residents: 0, workers: 4, visitors: 0, constructionWorkers: 2 },
  300,
  'shop',
);

export const SMALL_PARK_ARCHETYPE = createBuildingArchetype(
  'small-park',
  'leisure',
  6,
  6,
  { residents: 0, workers: 0, visitors: 5, constructionWorkers: 2 },
  600,
  'park',
);

export const BUILDING_ARCHETYPES: Readonly<Record<BuildingArchetypeId, BuildingArchetype>> =
  Object.freeze({
    'single-house': SINGLE_HOUSE_ARCHETYPE,
    'small-shop': SMALL_SHOP_ARCHETYPE,
    'small-park': SMALL_PARK_ARCHETYPE,
  });

export const BUILDING_ARCHETYPE_ORDER: readonly BuildingArchetypeId[] = Object.freeze([
  'single-house',
  'small-shop',
  'small-park',
]);

export function isBuildingArchetypeId(value: unknown): value is BuildingArchetypeId {
  return BUILDING_ARCHETYPE_ORDER.includes(value as BuildingArchetypeId);
}

export function getBuildingArchetype(id: BuildingArchetypeId): BuildingArchetype {
  return BUILDING_ARCHETYPES[id];
}

export type BuildingState =
  | {
      readonly kind: 'incomplete';
      readonly laborCompleted: number;
      readonly laborRequired: number;
    }
  | {
      readonly kind: 'complete';
    };

export interface BuildingAssignments {
  readonly constructionWorkerIds: readonly CitizenId[];
  readonly residentCitizenIds: readonly CitizenId[];
  readonly workerCitizenIds: readonly CitizenId[];
  readonly visitorReservationCitizenIds: readonly CitizenId[];
}

/** Geometry fields are intentionally flat so they are the authoritative cells. */
export interface BuildingInstance {
  readonly id: BuildingId;
  readonly zoneId: ZoneId;
  readonly archetypeId: BuildingArchetypeId;
  readonly origin: GridPosition;
  readonly transform: BuildingTransform;
  readonly physicalCells: readonly GridPosition[];
  readonly exclusionCells: readonly GridPosition[];
  readonly state: BuildingState;
  readonly assignments: BuildingAssignments;
}

/** Detached public building state for completed simulation snapshots. */
export interface BuildingSnapshot extends BuildingInstance {}

export interface CreateBuildingInstanceOptions {
  readonly id: BuildingId | string;
  readonly zoneId: ZoneId | string;
  readonly archetype: BuildingArchetype | BuildingArchetypeId;
  readonly origin: GridPosition;
  readonly transform?: BuildingTransform;
  readonly state?: BuildingState;
  readonly assignments?: BuildingAssignments;
}

function resolveBuildingArchetype(
  archetype: BuildingArchetype | BuildingArchetypeId,
): BuildingArchetype {
  if (typeof archetype === 'string') {
    if (!isBuildingArchetypeId(archetype)) {
      throw new Error(`Unknown building archetype ${archetype}.`);
    }
    return getBuildingArchetype(archetype);
  }
  return archetype;
}

function copyAssignments(assignments: BuildingAssignments): BuildingAssignments {
  return Object.freeze({
    constructionWorkerIds: Object.freeze([...assignments.constructionWorkerIds]),
    residentCitizenIds: Object.freeze([...assignments.residentCitizenIds]),
    workerCitizenIds: Object.freeze([...assignments.workerCitizenIds]),
    visitorReservationCitizenIds: Object.freeze([...assignments.visitorReservationCitizenIds]),
  });
}

export function createEmptyBuildingAssignments(): BuildingAssignments {
  return copyAssignments({
    constructionWorkerIds: [],
    residentCitizenIds: [],
    workerCitizenIds: [],
    visitorReservationCitizenIds: [],
  });
}

function copyBuildingState(state: BuildingState, laborRequired: number): BuildingState {
  if (state.kind === 'complete') return Object.freeze({ kind: 'complete' });
  if (
    !Number.isSafeInteger(state.laborCompleted) ||
    state.laborCompleted < 0 ||
    state.laborCompleted > laborRequired ||
    state.laborRequired !== laborRequired
  ) {
    throw new Error(
      'Incomplete building labor must be an integer within the archetype requirement.',
    );
  }
  return Object.freeze({
    kind: 'incomplete',
    laborCompleted: state.laborCompleted,
    laborRequired,
  });
}

/** Creates a detached, fully geometric instance without allocating an ID. */
export function createBuildingInstance(options: CreateBuildingInstanceOptions): BuildingInstance {
  const archetype = resolveBuildingArchetype(options.archetype);
  const transform = options.transform ?? 'identity';
  const geometry = getBuildingGeometry(archetype, options.origin, transform);
  const state = copyBuildingState(
    options.state ?? { kind: 'incomplete', laborCompleted: 0, laborRequired: archetype.labor },
    archetype.labor,
  );
  const assignments = copyAssignments(options.assignments ?? createEmptyBuildingAssignments());

  return Object.freeze({
    id: createBuildingId(String(options.id)),
    zoneId: createZoneId(String(options.zoneId)),
    archetypeId: archetype.id,
    origin: createGridPosition(options.origin.x, options.origin.y),
    transform,
    physicalCells: geometry.physicalCells,
    exclusionCells: geometry.exclusionCells,
    state,
    assignments,
  });
}

export function cloneBuildingInstance(building: BuildingInstance): BuildingInstance {
  const laborRequired = building.state.kind === 'complete' ? 0 : building.state.laborRequired;
  const state =
    building.state.kind === 'complete'
      ? Object.freeze({ kind: 'complete' as const })
      : copyBuildingState(building.state, laborRequired);
  return Object.freeze({
    id: building.id,
    zoneId: building.zoneId,
    archetypeId: building.archetypeId,
    origin: createGridPosition(building.origin.x, building.origin.y),
    transform: building.transform,
    physicalCells: copyCells(building.physicalCells),
    exclusionCells: copyCells(building.exclusionCells),
    state,
    assignments: copyAssignments(building.assignments),
  });
}

export function createBuildingSnapshot(building: BuildingInstance): BuildingSnapshot {
  return cloneBuildingInstance(building);
}

export interface BuildingPlacementZone {
  readonly type: ZoneType;
  readonly rect: GridRect;
}

export interface ExistingBuildingGeometry {
  readonly physicalCells: readonly GridPosition[];
  readonly exclusionCells: readonly GridPosition[];
}

export type BuildingPlacementCitizen =
  | GridPosition
  | {
      readonly position: GridPosition;
    };

export interface BuildingPlacementRequest {
  readonly archetype: BuildingArchetype | BuildingArchetypeId;
  readonly zone: BuildingPlacementZone;
  readonly origin: GridPosition;
  readonly transform?: BuildingTransform;
  readonly existingBuildings?: readonly ExistingBuildingGeometry[];
  /** Short alias useful to callers that already call the collection buildings. */
  readonly buildings?: readonly ExistingBuildingGeometry[];
  readonly citizens?: readonly BuildingPlacementCitizen[];
}

export type BuildingPlacementRejectionReason =
  | 'invalid-archetype'
  | 'archetype-zone-mismatch'
  | 'unsupported-transform'
  | 'invalid-coordinates'
  | 'physical-outside-zone'
  | 'exclusion-outside-zone'
  | 'physical-overlap'
  | 'physical-exclusion-overlap'
  | 'exclusion-physical-overlap'
  | 'citizen-occupies-physical-cell';

export type BuildingPlacementValidation =
  | {
      readonly valid: true;
      readonly archetypeId: BuildingArchetypeId;
      readonly origin: GridPosition;
      readonly transform: BuildingTransform;
      readonly geometry: BuildingGeometry;
    }
  | {
      readonly valid: false;
      readonly reason: BuildingPlacementRejectionReason;
    };

function isValidPosition(position: GridPosition): boolean {
  return Number.isSafeInteger(position.x) && Number.isSafeInteger(position.y);
}

function isValidRect(rect: GridRect): boolean {
  return (
    Number.isSafeInteger(rect.x) &&
    Number.isSafeInteger(rect.y) &&
    Number.isSafeInteger(rect.width) &&
    Number.isSafeInteger(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    Number.isSafeInteger(rect.x + rect.width - 1) &&
    Number.isSafeInteger(rect.y + rect.height - 1)
  );
}

function isInsideRect(position: GridPosition, rect: GridRect): boolean {
  return (
    position.x >= rect.x &&
    position.y >= rect.y &&
    position.x <= rect.x + rect.width - 1 &&
    position.y <= rect.y + rect.height - 1
  );
}

function allCellsInsideRect(cells: readonly GridPosition[], rect: GridRect): boolean {
  return cells.every((cell) => isInsideRect(cell, rect));
}

function cellsOverlap(left: readonly GridPosition[], right: readonly GridPosition[]): boolean {
  const rightKeys = new Set(right.map(positionKey));
  return left.some((cell) => rightKeys.has(positionKey(cell)));
}

function placementCitizenPosition(citizen: BuildingPlacementCitizen): GridPosition {
  if ('position' in citizen) return citizen.position;
  return citizen;
}

function resolvedExistingBuildings(
  request: BuildingPlacementRequest,
): readonly ExistingBuildingGeometry[] {
  return request.existingBuildings ?? request.buildings ?? [];
}

/**
 * Purely validates a candidate against detached zone, building, and citizen
 * geometry. The state of an existing building is deliberately not consulted:
 * incomplete and complete geometry reserve the same cells.
 */
export function validateBuildingPlacement(
  request: BuildingPlacementRequest,
): BuildingPlacementValidation {
  let archetype: BuildingArchetype;
  try {
    archetype = resolveBuildingArchetype(request.archetype);
  } catch {
    return { valid: false, reason: 'invalid-archetype' };
  }

  if (archetype.zoneType !== request.zone.type) {
    return { valid: false, reason: 'archetype-zone-mismatch' };
  }

  const transform = request.transform ?? 'identity';
  if (!isBuildingTransform(transform) || !archetype.supportedTransforms.includes(transform)) {
    return { valid: false, reason: 'unsupported-transform' };
  }
  if (!isValidRect(request.zone.rect) || !isValidPosition(request.origin)) {
    return { valid: false, reason: 'invalid-coordinates' };
  }

  let geometry: BuildingGeometry;
  try {
    geometry = getBuildingGeometry(archetype, request.origin, transform);
  } catch {
    return { valid: false, reason: 'invalid-coordinates' };
  }

  if (!allCellsInsideRect(geometry.physicalCells, request.zone.rect)) {
    return { valid: false, reason: 'physical-outside-zone' };
  }
  if (!allCellsInsideRect(geometry.exclusionCells, request.zone.rect)) {
    return { valid: false, reason: 'exclusion-outside-zone' };
  }

  for (const existing of resolvedExistingBuildings(request)) {
    if (cellsOverlap(geometry.physicalCells, existing.physicalCells)) {
      return { valid: false, reason: 'physical-overlap' };
    }
  }
  for (const existing of resolvedExistingBuildings(request)) {
    if (cellsOverlap(geometry.physicalCells, existing.exclusionCells)) {
      return { valid: false, reason: 'physical-exclusion-overlap' };
    }
  }
  for (const existing of resolvedExistingBuildings(request)) {
    if (cellsOverlap(geometry.exclusionCells, existing.physicalCells)) {
      return { valid: false, reason: 'exclusion-physical-overlap' };
    }
  }

  for (const citizen of request.citizens ?? []) {
    const position = placementCitizenPosition(citizen);
    if (geometry.physicalCells.some((cell) => positionKey(cell) === positionKey(position))) {
      return { valid: false, reason: 'citizen-occupies-physical-cell' };
    }
  }

  return {
    valid: true,
    archetypeId: archetype.id,
    origin: createGridPosition(request.origin.x, request.origin.y),
    transform,
    geometry,
  };
}

export function isValidBuildingPlacement(request: BuildingPlacementRequest): boolean {
  return validateBuildingPlacement(request).valid;
}
