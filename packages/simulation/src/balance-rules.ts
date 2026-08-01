import type { DistrictSeedKind } from './types';

/** Data costs are authoritative simulation rules, not presentation values. */
export const DISTRICT_SEED_COSTS = {
  living: 10,
  working: 12,
  services: 20,
} as const satisfies Readonly<Record<DistrictSeedKind, number>>;

const unlockedDistrictSeedKinds: readonly DistrictSeedKind[] = ['living', 'working'];

export function getDistrictSeedCost(kind: DistrictSeedKind): number {
  return DISTRICT_SEED_COSTS[kind];
}

export function isDistrictSeedKindUnlocked(kind: DistrictSeedKind): boolean {
  return unlockedDistrictSeedKinds.includes(kind);
}
