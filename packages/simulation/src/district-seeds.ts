import { squareDistance } from '@idle-city/shared';
import type { GridPosition } from '@idle-city/shared';
import { DISTRICT_SEED_COSTS, isDistrictSeedKindUnlocked } from './balance-rules';
import type { DistrictSeed, DistrictSeedDefinition, DistrictSeedKind } from './types';

const influencePrecision = 1_000_000;

export const DISTRICT_SEED_DEFINITIONS: Readonly<Record<DistrictSeedKind, DistrictSeedDefinition>> =
  {
    living: {
      kind: 'living',
      label: 'Living',
      baseCost: DISTRICT_SEED_COSTS.living,
      influenceRadius: 10,
      sideLength: 21,
      influenceShape: 'square',
      unlocked: isDistrictSeedKindUnlocked('living'),
    },
    working: {
      kind: 'working',
      label: 'Working',
      baseCost: DISTRICT_SEED_COSTS.working,
      influenceRadius: 12,
      sideLength: 25,
      influenceShape: 'square',
      unlocked: isDistrictSeedKindUnlocked('working'),
    },
    services: {
      kind: 'services',
      label: 'Services',
      baseCost: DISTRICT_SEED_COSTS.services,
      influenceRadius: 8,
      sideLength: 17,
      influenceShape: 'square',
      unlocked: isDistrictSeedKindUnlocked('services'),
    },
  };

export function getDistrictSeedDefinition(kind: DistrictSeedKind): DistrictSeedDefinition {
  return { ...DISTRICT_SEED_DEFINITIONS[kind] };
}

export function getDistrictSeedDefinitions(): readonly DistrictSeedDefinition[] {
  return (['living', 'working', 'services'] as const).map((kind) =>
    getDistrictSeedDefinition(kind),
  );
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

export function districtSeedInfluenceRadius(kind: DistrictSeedKind): number {
  return DISTRICT_SEED_DEFINITIONS[kind].influenceRadius;
}

/** Complete matching-type square in stable row-major order. */
export function enumerateDistrictSeedInfluenceCells(
  position: GridPosition,
  kind: DistrictSeedKind,
): GridPosition[] {
  const radius = districtSeedInfluenceRadius(kind);
  const cells: GridPosition[] = [];
  for (let y = position.y - radius; y <= position.y + radius; y += 1) {
    for (let x = position.x - radius; x <= position.x + radius; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * A seed contributes (radius + 1 - Chebyshev distance) / (radius + 1) inside
 * its square, including a positive contribution on the outer boundary.
 * Matching contributions are rounded, added, capped at one, and rounded again
 * so preview, demand, and developer scoring share one exact field.
 */
export function calculateDistrictSeedInfluence(input: DistrictSeedInfluenceInput): number {
  const radius = Math.max(
    1,
    input.radius ??
      (input.width === undefined || input.height === undefined
        ? districtSeedInfluenceRadius(input.kind)
        : Math.max(input.width, input.height) - 1),
  );
  let total = 0;
  for (const seed of input.seeds) {
    if (seed.kind !== input.kind) continue;
    const distance = squareDistance(input.position, seed.position);
    const contribution = roundInfluence(Math.max(0, (radius + 1 - distance) / (radius + 1)));
    total = roundInfluence(Math.min(1, total + contribution));
    if (total >= 1) return 1;
  }
  return roundInfluence(Math.min(1, total));
}
