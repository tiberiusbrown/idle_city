import {
  getChunkCoordinates,
  getChunkKey,
  type ChunkCoordinates,
  type GridPosition,
  type GridRect,
} from '@idle-city/shared';

/** The intentionally minimal authoritative record for an allocated chunk. */
export type ChunkRecord = ChunkCoordinates;

/** Chunk allocation is storage state, not a gameplay boundary or obstacle. */
export interface WorldState {
  readonly chunks: Map<string, ChunkRecord>;
}

export function createWorld(): WorldState {
  return { chunks: new Map() };
}

export function cloneWorld(world: WorldState): WorldState {
  return { chunks: new Map(world.chunks) };
}

/** Allocates only the chunk containing the requested cell. */
export function ensureChunkAt(world: WorldState, position: GridPosition): ChunkRecord {
  const coordinates = getChunkCoordinates(position);
  return ensureChunkAtCoordinates(world, coordinates);
}

function ensureChunkAtCoordinates(world: WorldState, coordinates: ChunkCoordinates): ChunkRecord {
  const key = getChunkKey(coordinates);
  const existing = world.chunks.get(key);
  if (existing !== undefined) return existing;

  const chunk: ChunkRecord = Object.freeze({ x: coordinates.x, y: coordinates.y });
  world.chunks.set(key, chunk);
  return chunk;
}

/** Allocates every chunk intersected by a non-empty logical rectangle. */
export function ensureChunksForRect(world: WorldState, rect: GridRect): void {
  const minimum = getChunkCoordinates({ x: rect.x, y: rect.y });
  const maximum = getChunkCoordinates({
    x: rect.x + rect.width - 1,
    y: rect.y + rect.height - 1,
  });

  for (let chunkY = minimum.y; chunkY <= maximum.y; chunkY += 1) {
    for (let chunkX = minimum.x; chunkX <= maximum.x; chunkX += 1) {
      ensureChunkAtCoordinates(world, { x: chunkX, y: chunkY });
    }
  }
}

/** Returns chunk records in a stable order for diagnostics and hashing. */
export function getSortedChunks(world: WorldState): readonly ChunkRecord[] {
  return [...world.chunks.values()].sort((left, right) => left.y - right.y || left.x - right.x);
}
