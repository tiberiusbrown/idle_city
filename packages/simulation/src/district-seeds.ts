import type { GridPosition } from '@idle-city/shared';
import type { DistrictSeed, DistrictSeedKind } from './types';

const influencePrecision = 1_000_000;

function manhattanDistance(left: GridPosition, right: GridPosition): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function roundInfluence(value: number): number {
  return Math.round(value * influencePrecision) / influencePrecision;
}

export interface DistrictSeedInfluenceInput {
  readonly width?: number;
  readonly height?: number;
  readonly radius?: number;
  readonly seeds: readonly DistrictSeed[];
  readonly position: GridPosition;
  readonly kind: DistrictSeedKind;
}

/**
 * A seed contributes max(0, 1 - distance / max(1, width + height - 2)).
 * Contributions from matching seeds are added, capped at 1, and rounded to
 * six decimal places. The Manhattan distance keeps the field aligned with the
 * simulation's grid movement and the cap keeps influence normalized.
 */
export function calculateDistrictSeedInfluence(input: DistrictSeedInfluenceInput): number {
  const radius = Math.max(
    1,
    input.radius ??
      (input.width === undefined || input.height === undefined
        ? 1
        : input.width + input.height - 2),
  );
  let total = 0;
  for (const seed of input.seeds) {
    if (seed.kind !== input.kind) continue;
    const distance = manhattanDistance(input.position, seed.position);
    total += Math.max(0, 1 - distance / radius);
    if (total >= 1) return 1;
  }
  return roundInfluence(Math.min(1, total));
}
