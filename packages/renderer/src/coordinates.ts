import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { GridPosition } from '@idle-city/shared';

export const DEFAULT_LOGICAL_CELL_WORLD_SCALE = 1;

function validateCellWorldScale(cellWorldScale: number): number {
  if (!Number.isFinite(cellWorldScale) || cellWorldScale <= 0) {
    throw new Error(`cellWorldScale must be positive; received ${String(cellWorldScale)}.`);
  }
  return cellWorldScale;
}

/** Converts a logical cell to the center of that cell in Babylon world space. */
export function logicalToWorld(
  position: GridPosition,
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): Vector3 {
  validateCellWorldScale(cellWorldScale);
  return new Vector3((position.x + 0.5) * cellWorldScale, 0, (position.y + 0.5) * cellWorldScale);
}
