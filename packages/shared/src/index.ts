/** A signed, integer position in the authoritative world grid. */
export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle of logical grid cells. */
export interface GridRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The centralized logical chunk width and height. */
export const CHUNK_SIZE = 32;

/** A signed chunk coordinate. */
export interface ChunkCoordinates {
  readonly x: number;
  readonly y: number;
}

function validateChunkSize(chunkSize: number): number {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Chunk size must be a positive safe integer; received ${String(chunkSize)}.`);
  }
  return chunkSize;
}

/** Creates an immutable grid position and rejects non-integer coordinates. */
export function createGridPosition(x: number, y: number): GridPosition {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error(
      `Grid positions must use safe integer coordinates; received (${String(x)}, ${String(y)}).`,
    );
  }

  return Object.freeze({ x, y });
}

/** Creates an immutable, non-empty rectangle of safe integer grid cells. */
export function createGridRect(x: number, y: number, width: number, height: number): GridRect {
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(x + width - 1) ||
    !Number.isSafeInteger(y + height - 1)
  ) {
    throw new Error(
      `Grid rectangles must be non-empty and fit within safe integer coordinates; received (${String(x)}, ${String(y)}, ${String(width)}, ${String(height)}).`,
    );
  }

  return Object.freeze({ x, y, width, height });
}

/**
 * Converts a signed logical cell to its chunk using mathematical floor
 * division. In particular, cell -1 belongs to chunk -1 rather than chunk 0.
 */
export function getChunkCoordinates(
  position: GridPosition,
  chunkSize = CHUNK_SIZE,
): ChunkCoordinates {
  const size = validateChunkSize(chunkSize);
  return Object.freeze({
    x: Math.floor(position.x / size),
    y: Math.floor(position.y / size),
  });
}

/** Returns the nonnegative local cell coordinate inside a signed chunk. */
export function getChunkLocalPosition(
  position: GridPosition,
  chunkSize = CHUNK_SIZE,
): GridPosition {
  const size = validateChunkSize(chunkSize);
  const chunk = getChunkCoordinates(position, size);
  return createGridPosition(position.x - chunk.x * size, position.y - chunk.y * size);
}

/** Creates a stable serialized key for a chunk coordinate. */
export function getChunkKey(chunk: ChunkCoordinates): string {
  return `${String(chunk.x)},${String(chunk.y)}`;
}

declare const citizenIdBrand: unique symbol;

/** A stable authoritative identifier for a citizen. */
export type CitizenId = string & {
  readonly [citizenIdBrand]: 'CitizenId';
};

/** Brands a serialized citizen identifier without changing its runtime value. */
export function createCitizenId(value: string): CitizenId {
  if (value.length === 0) throw new Error('Citizen IDs must not be empty.');
  return value as CitizenId;
}

declare const zoneIdBrand: unique symbol;

/** A stable authoritative identifier for a zone. */
export type ZoneId = string & {
  readonly [zoneIdBrand]: 'ZoneId';
};

/** Brands a serialized zone identifier without changing its runtime value. */
export function createZoneId(value: string): ZoneId {
  if (value.length === 0) throw new Error('Zone IDs must not be empty.');
  return value as ZoneId;
}

declare const buildingIdBrand: unique symbol;

/** A stable authoritative identifier for a building. */
export type BuildingId = string & {
  readonly [buildingIdBrand]: 'BuildingId';
};

/** Brands a serialized building identifier without changing its runtime value. */
export function createBuildingId(value: string): BuildingId {
  if (value.length === 0) throw new Error('Building IDs must not be empty.');
  return value as BuildingId;
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, ordered(child)]),
    );
  }
  return value;
}

/** Creates a small deterministic hash for serializable values. */
export function stableHash(value: unknown): string {
  const input = JSON.stringify(ordered(value));
  let hash = 0x811c9dc5;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
