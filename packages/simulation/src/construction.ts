import type { ConstructionPhase } from './types';

export const CONSTRUCTION_PHASE_ORDER: readonly ConstructionPhase[] = [
  'survey',
  'blueprint',
  'foundation',
  'frame',
  'completion',
];

/**
 * A project is created in survey with its full footprint already reserved.
 * Each duration is a count of subsequent logical ticks spent in that phase.
 * The default total is 16 ticks: 2 + 3 + 4 + 6 + 1.
 */
export const DEFAULT_CONSTRUCTION_PHASE_DURATIONS: Readonly<Record<ConstructionPhase, number>> = {
  survey: 2,
  blueprint: 3,
  foundation: 4,
  frame: 6,
  completion: 1,
};

export function validateConstructionPhaseDurations(
  overrides: Partial<Record<ConstructionPhase, number>> | undefined,
): Record<ConstructionPhase, number> {
  const result = { ...DEFAULT_CONSTRUCTION_PHASE_DURATIONS };
  if (overrides === undefined) return result;
  for (const phase of CONSTRUCTION_PHASE_ORDER) {
    const duration = overrides[phase];
    if (duration === undefined) continue;
    if (!Number.isSafeInteger(duration) || duration < 1) {
      throw new Error(
        `Construction duration for ${phase} must be a positive safe integer; received ${String(duration)}.`,
      );
    }
    result[phase] = duration;
  }
  return result;
}

export function nextConstructionPhase(phase: ConstructionPhase): ConstructionPhase | undefined {
  const index = CONSTRUCTION_PHASE_ORDER.indexOf(phase);
  if (index < 0) throw new Error(`Unknown construction phase ${phase}.`);
  return CONSTRUCTION_PHASE_ORDER[index + 1];
}
