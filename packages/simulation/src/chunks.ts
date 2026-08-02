import type { ChunkCoordinate, GridPosition } from '@idle-city/shared';

export const DEFAULT_CHUNK_SIZE = 32;

interface OccupancyChunk {
  readonly coordinate: ChunkCoordinate;
  readonly key: string;
  occupied: Uint8Array | undefined;
  rightOfWay: Uint8Array | undefined;
  revision: number;
  rightOfWayRevision: number;
  staticTopologyRevision: number;
}

function safeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer; received ${String(value)}.`);
  }
  return value;
}

export function validateChunkSize(value: number): number {
  safeInteger('chunkSize', value);
  if (value < 2) throw new Error(`chunkSize must be at least 2; received ${String(value)}.`);
  return value;
}

export function chunkKey(chunk: ChunkCoordinate): string {
  safeInteger('chunk.x', chunk.x);
  safeInteger('chunk.y', chunk.y);
  return `${String(chunk.x)}:${String(chunk.y)}`;
}

/** Math.floor is intentional: it keeps negative world coordinates in the correct chunk. */
export function chunkCoordinateForPosition(
  position: GridPosition,
  chunkSize: number,
): ChunkCoordinate {
  validateChunkSize(chunkSize);
  safeInteger('position.x', position.x);
  safeInteger('position.y', position.y);
  return {
    x: Math.floor(position.x / chunkSize),
    y: Math.floor(position.y / chunkSize),
  };
}

export function localCoordinateForPosition(
  position: GridPosition,
  chunkSize: number,
): GridPosition {
  const chunk = chunkCoordinateForPosition(position, chunkSize);
  return {
    x: position.x - chunk.x * chunkSize,
    y: position.y - chunk.y * chunkSize,
  };
}

export function chunkOrigin(chunk: ChunkCoordinate, chunkSize: number): GridPosition {
  validateChunkSize(chunkSize);
  safeInteger('chunk.x', chunk.x);
  safeInteger('chunk.y', chunk.y);
  const x = chunk.x * chunkSize;
  const y = chunk.y * chunkSize;
  safeInteger('chunk origin x', x);
  safeInteger('chunk origin y', y);
  return { x, y };
}

export function compareChunks(left: ChunkCoordinate, right: ChunkCoordinate): number {
  return left.y === right.y ? left.x - right.x : left.y - right.y;
}

export function adjacentChunks(left: ChunkCoordinate, right: ChunkCoordinate): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

export function enumerateChunkRegion(region: {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}): ChunkCoordinate[] {
  safeInteger('region.minX', region.minX);
  safeInteger('region.minY', region.minY);
  safeInteger('region.width', region.width);
  safeInteger('region.height', region.height);
  if (region.width < 1 || region.height < 1) {
    throw new Error('Chunk region dimensions must be positive.');
  }
  const chunks: ChunkCoordinate[] = [];
  for (let y = region.minY; y < region.minY + region.height; y += 1) {
    for (let x = region.minX; x < region.minX + region.width; x += 1) {
      chunks.push({ x, y });
    }
  }
  return chunks;
}

export function createChunkSpatialStore(chunkSize: number): ChunkSpatialStore {
  return new ChunkSpatialStore(chunkSize);
}

export class ChunkSpatialStore {
  private readonly chunks = new Map<string, OccupancyChunk>();

  public constructor(public readonly chunkSize: number) {
    validateChunkSize(chunkSize);
  }

  public activate(chunk: ChunkCoordinate): boolean {
    const key = chunkKey(chunk);
    if (this.chunks.has(key)) return false;
    this.chunks.set(key, {
      coordinate: { x: chunk.x, y: chunk.y },
      key,
      occupied: undefined,
      rightOfWay: undefined,
      revision: 0,
      rightOfWayRevision: 0,
      staticTopologyRevision: 0,
    });
    return true;
  }

  public isActive(chunk: ChunkCoordinate): boolean {
    return this.chunks.has(chunkKey(chunk));
  }

  public isPositionActive(position: GridPosition): boolean {
    return this.isActive(chunkCoordinateForPosition(position, this.chunkSize));
  }

  public isWalkable(position: GridPosition): boolean {
    const chunk = this.chunks.get(chunkKey(chunkCoordinateForPosition(position, this.chunkSize)));
    if (chunk === undefined) return false;
    const local = localCoordinateForPosition(position, this.chunkSize);
    return chunk.occupied?.[local.y * this.chunkSize + local.x] !== 1;
  }

  public isRightOfWay(position: GridPosition): boolean {
    const chunk = this.chunks.get(chunkKey(chunkCoordinateForPosition(position, this.chunkSize)));
    if (chunk === undefined) return false;
    const local = localCoordinateForPosition(position, this.chunkSize);
    return chunk.rightOfWay?.[local.y * this.chunkSize + local.x] === 1;
  }

  public isRow(position: GridPosition): boolean {
    return this.isRightOfWay(position);
  }

  /** Buildable means active, walkable, and not public right-of-way. */
  public isBuildable(position: GridPosition): boolean {
    return (
      this.isPositionActive(position) && this.isWalkable(position) && !this.isRightOfWay(position)
    );
  }

  public block(position: GridPosition): void {
    const chunk = this.chunks.get(chunkKey(chunkCoordinateForPosition(position, this.chunkSize)));
    if (chunk === undefined) {
      throw new Error(
        `Cannot block inactive position ${String(position.x)},${String(position.y)}.`,
      );
    }
    const local = localCoordinateForPosition(position, this.chunkSize);
    const rowIndex = local.y * this.chunkSize + local.x;
    if (chunk.rightOfWay?.[rowIndex] === 1) {
      throw new Error(
        `Cannot block public right-of-way ${String(position.x)},${String(position.y)}.`,
      );
    }
    chunk.occupied ??= new Uint8Array(this.chunkSize ** 2);
    const index = rowIndex;
    if (chunk.occupied[index] === 1) return;
    chunk.occupied[index] = 1;
    chunk.revision += 1;
    chunk.staticTopologyRevision += 1;
  }

  public blockMany(positions: readonly GridPosition[]): void {
    for (const position of positions) this.block(position);
  }

  public getChunkRevision(chunk: ChunkCoordinate): number {
    return this.chunks.get(chunkKey(chunk))?.revision ?? 0;
  }

  public getRightOfWayRevision(chunk: ChunkCoordinate): number {
    return this.chunks.get(chunkKey(chunk))?.rightOfWayRevision ?? 0;
  }

  public getRowRevision(chunk: ChunkCoordinate): number {
    return this.getRightOfWayRevision(chunk);
  }

  public getStaticTopologyRevision(chunk: ChunkCoordinate): number {
    return this.chunks.get(chunkKey(chunk))?.staticTopologyRevision ?? 0;
  }

  public hasOccupancyBuffer(chunk: ChunkCoordinate): boolean {
    return this.chunks.get(chunkKey(chunk))?.occupied !== undefined;
  }

  public hasRightOfWayBuffer(chunk: ChunkCoordinate): boolean {
    return this.chunks.get(chunkKey(chunk))?.rightOfWay !== undefined;
  }

  public hasRowBuffer(chunk: ChunkCoordinate): boolean {
    return this.hasRightOfWayBuffer(chunk);
  }

  public markRightOfWay(position: GridPosition): void {
    const chunk = this.chunks.get(chunkKey(chunkCoordinateForPosition(position, this.chunkSize)));
    if (chunk === undefined) {
      throw new Error(
        `Cannot mark right-of-way in inactive position ${String(position.x)},${String(position.y)}.`,
      );
    }
    const local = localCoordinateForPosition(position, this.chunkSize);
    const index = local.y * this.chunkSize + local.x;
    if (chunk.occupied?.[index] === 1) {
      throw new Error(
        `Cannot mark building interior as public right-of-way ${String(position.x)},${String(position.y)}.`,
      );
    }
    chunk.rightOfWay ??= new Uint8Array(this.chunkSize ** 2);
    if (chunk.rightOfWay[index] === 1) return;
    chunk.rightOfWay[index] = 1;
    chunk.rightOfWayRevision += 1;
    chunk.staticTopologyRevision += 1;
  }

  public markRow(position: GridPosition): void {
    this.markRightOfWay(position);
  }

  /** Validates the complete batch before mutating any cell. */
  public markRightOfWayMany(positions: readonly GridPosition[]): void {
    const unique = new Map<string, GridPosition>();
    for (const position of positions)
      unique.set(`${String(position.x)},${String(position.y)}`, position);
    for (const position of unique.values()) {
      const chunk = this.chunks.get(chunkKey(chunkCoordinateForPosition(position, this.chunkSize)));
      if (chunk === undefined)
        throw new Error(
          `Cannot mark inactive right-of-way cell ${String(position.x)},${String(position.y)}.`,
        );
      const local = localCoordinateForPosition(position, this.chunkSize);
      const index = local.y * this.chunkSize + local.x;
      if (chunk.occupied?.[index] === 1)
        throw new Error(
          `Cannot mark occupied right-of-way cell ${String(position.x)},${String(position.y)}.`,
        );
    }
    for (const position of unique.values()) this.markRightOfWay(position);
  }

  public markRowMany(positions: readonly GridPosition[]): void {
    this.markRightOfWayMany(positions);
  }

  public getRightOfWayCells(chunk: ChunkCoordinate): GridPosition[] {
    const state = this.chunks.get(chunkKey(chunk));
    if (state?.rightOfWay === undefined) return [];
    const origin = chunkOrigin(chunk, this.chunkSize);
    const cells: GridPosition[] = [];
    for (let localY = 0; localY < this.chunkSize; localY += 1) {
      for (let localX = 0; localX < this.chunkSize; localX += 1) {
        if (state.rightOfWay[localY * this.chunkSize + localX] !== 1) continue;
        cells.push({ x: origin.x + localX, y: origin.y + localY });
      }
    }
    return cells;
  }

  public getRowCells(chunk: ChunkCoordinate): GridPosition[] {
    return this.getRightOfWayCells(chunk);
  }

  public getAllocatedOccupancyBufferCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.occupied !== undefined) count += 1;
    }
    return count;
  }

  public getAllocatedRightOfWayBufferCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.rightOfWay !== undefined) count += 1;
    }
    return count;
  }

  public getAllocatedRowBufferCount(): number {
    return this.getAllocatedRightOfWayBufferCount();
  }

  public getRightOfWayCellCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.rightOfWay === undefined) continue;
      for (const value of chunk.rightOfWay) count += value === 1 ? 1 : 0;
    }
    return count;
  }

  public getRowCellCount(): number {
    return this.getRightOfWayCellCount();
  }

  public getStaticTopologyRevisionTotal(): number {
    let revision = 0;
    for (const chunk of this.chunks.values()) revision += chunk.staticTopologyRevision;
    return revision;
  }

  public getActiveChunks(): ChunkCoordinate[] {
    return [...this.chunks.values()].map((chunk) => ({ ...chunk.coordinate })).sort(compareChunks);
  }

  public getChunkKey(chunk: ChunkCoordinate): string {
    return chunkKey(chunk);
  }
}
