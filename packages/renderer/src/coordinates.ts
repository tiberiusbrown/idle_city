import type { ChunkCoordinate, GridPosition, GridRect } from '@idle-city/shared';
import { chunkCoordinateForPosition } from '@idle-city/simulation';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export const DEFAULT_LOGICAL_CELL_WORLD_SCALE = 0.25;

function validateCellWorldScale(cellWorldScale: number): number {
  if (!Number.isFinite(cellWorldScale) || cellWorldScale <= 0) {
    throw new Error(`cellWorldScale must be positive; received ${String(cellWorldScale)}.`);
  }
  return cellWorldScale;
}

export function clampInterpolation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Convert a logical cell position to the center of that cell in Babylon space. */
export function logicalToWorld(
  position: GridPosition,
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): Vector3 {
  validateCellWorldScale(cellWorldScale);
  return new Vector3((position.x + 0.5) * cellWorldScale, 0, (position.y + 0.5) * cellWorldScale);
}

/** Convert a picked Babylon world position to the containing logical cell. */
export function worldToLogicalCell(
  world: { readonly x: number; readonly z: number },
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): GridPosition {
  validateCellWorldScale(cellWorldScale);
  if (!Number.isFinite(world.x) || !Number.isFinite(world.z)) {
    throw new Error('World positions must contain finite x and z coordinates.');
  }
  return {
    x: Math.floor(world.x / cellWorldScale),
    y: Math.floor(world.z / cellWorldScale),
  };
}

/** Convert logical coordinates to an authoritative signed chunk coordinate. */
export function logicalCellToChunk(position: GridPosition, chunkSize: number): ChunkCoordinate {
  return chunkCoordinateForPosition(position, chunkSize);
}

/** Convert a Babylon world position directly to its authoritative signed chunk. */
export function worldToChunk(
  world: { readonly x: number; readonly z: number },
  chunkSize: number,
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): ChunkCoordinate {
  return logicalCellToChunk(worldToLogicalCell(world, cellWorldScale), chunkSize);
}

/** Convert viewport pointer coordinates to canvas-local coordinates for Babylon picking. */
export function pointerToCanvasPosition(
  pointer: { readonly clientX: number; readonly clientY: number },
  canvas: HTMLCanvasElement,
): { readonly x: number; readonly y: number } {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: pointer.clientX - bounds.left,
    y: pointer.clientY - bounds.top,
  };
}

/** Interpolate detached coordinates without ever writing into a snapshot position. */
export function interpolateLogicalPosition(
  previous: GridPosition,
  current: GridPosition,
  interpolation: number,
): GridPosition {
  const alpha = clampInterpolation(interpolation);
  return {
    x: previous.x + (current.x - previous.x) * alpha,
    y: previous.y + (current.y - previous.y) * alpha,
  };
}

export function footprintToWorldCenter(
  footprint: GridRect,
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): Vector3 {
  validateCellWorldScale(cellWorldScale);
  return new Vector3(
    (footprint.x + footprint.width / 2) * cellWorldScale,
    0,
    (footprint.y + footprint.height / 2) * cellWorldScale,
  );
}

export function footprintToWorldSize(
  footprint: GridRect,
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): { readonly width: number; readonly depth: number } {
  validateCellWorldScale(cellWorldScale);
  return {
    width: footprint.width * cellWorldScale,
    depth: footprint.height * cellWorldScale,
  };
}

export function chunkToWorldCenter(
  chunk: ChunkCoordinate,
  chunkSize: number,
  cellWorldScale: number,
): Vector3 {
  validateCellWorldScale(cellWorldScale);
  return new Vector3(
    (chunk.x * chunkSize + chunkSize / 2) * cellWorldScale,
    -0.08,
    (chunk.y * chunkSize + chunkSize / 2) * cellWorldScale,
  );
}
