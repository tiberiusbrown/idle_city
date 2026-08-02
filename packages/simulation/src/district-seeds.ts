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
      unlocked: isDistrictSeedKindUnlocked('living'),
    },
    working: {
      kind: 'working',
      label: 'Working',
      baseCost: DISTRICT_SEED_COSTS.working,
      influenceRadius: 12,
      unlocked: isDistrictSeedKindUnlocked('working'),
    },
    services: {
      kind: 'services',
      label: 'Services',
      baseCost: DISTRICT_SEED_COSTS.services,
      influenceRadius: 8,
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

export function districtSeedInfluenceRadius(kind: DistrictSeedKind): number {
  return DISTRICT_SEED_DEFINITIONS[kind].influenceRadius;
}

/** Complete matching-type Manhattan diamond in stable row-major order. */
export function enumerateDistrictSeedInfluenceCells(
  position: GridPosition,
  kind: DistrictSeedKind,
): GridPosition[] {
  const radius = districtSeedInfluenceRadius(kind);
  const cells: GridPosition[] = [];
  for (let y = position.y - radius; y <= position.y + radius; y += 1) {
    const remaining = radius - Math.abs(y - position.y);
    for (let x = position.x - remaining; x <= position.x + remaining; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * A seed contributes max(0, 1 - distance / radius).
 * Contributions from matching seeds are added, capped at 1, and rounded to
 * six decimal places. The Manhattan distance keeps the field aligned with the
 * simulation's grid movement and the cap keeps influence normalized.
 */
export function calculateDistrictSeedInfluence(input: DistrictSeedInfluenceInput): number {
  const radius = Math.max(
    1,
    input.radius ??
      (input.width === undefined || input.height === undefined
        ? districtSeedInfluenceRadius(input.kind)
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
