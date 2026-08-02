import type { ChunkCoordinate, GridPosition, GridRect } from '@idle-city/shared';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export const DEFAULT_LOGICAL_CELL_WORLD_SCALE = 0.25;

export function clampInterpolation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Convert a logical cell position to the center of that cell in Babylon space. */
export function logicalToWorld(
  position: GridPosition,
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): Vector3 {
  return new Vector3((position.x + 0.5) * cellWorldScale, 0, (position.y + 0.5) * cellWorldScale);
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
  return new Vector3(
    (chunk.x * chunkSize + chunkSize / 2) * cellWorldScale,
    -0.08,
    (chunk.y * chunkSize + chunkSize / 2) * cellWorldScale,
  );
}
