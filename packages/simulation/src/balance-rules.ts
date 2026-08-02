import type { DistrictSeedKind } from './types';

export const SERVICES_CORE_COST = 50;
export const SERVICES_CORE_MINIMUM_POPULATION = 20;
export const SERVICES_CORE_MINIMUM_WORK_ACTIVITIES = 40;

/** Data costs are authoritative simulation rules, not presentation values. */
export const DISTRICT_SEED_COSTS = {
  living: 10,
  working: 12,
  services: 20,
} as const satisfies Readonly<Record<DistrictSeedKind, number>>;

export const DISTRICT_SEED_COST_GROWTH_FACTOR = 1.25;

const unlockedDistrictSeedKinds: readonly DistrictSeedKind[] = ['living', 'working'];

export function getDistrictSeedCost(kind: DistrictSeedKind, activeSameTypeCount = 0): number {
  if (!Number.isSafeInteger(activeSameTypeCount) || activeSameTypeCount < 0) {
    throw new Error(
      `activeSameTypeCount must be a non-negative safe integer; received ${String(activeSameTypeCount)}.`,
    );
  }
  return Math.ceil(
    DISTRICT_SEED_COSTS[kind] * DISTRICT_SEED_COST_GROWTH_FACTOR ** activeSameTypeCount,
  );
}

export function isDistrictSeedKindUnlocked(kind: DistrictSeedKind): boolean {
  return unlockedDistrictSeedKinds.includes(kind);
}
