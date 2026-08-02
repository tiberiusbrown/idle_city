import type { ConstructionPhase } from './types';

export const CONSTRUCTION_PHASE_ORDER: readonly ConstructionPhase[] = [
  'survey',
  'blueprint',
  'foundation',
  'frame',
  'completion',
];

/** A project is created in survey with its full footprint already reserved. */
export const DEFAULT_CONSTRUCTION_PHASE_DURATIONS: Readonly<Record<ConstructionPhase, number>> = {
  survey: 2,
  blueprint: 3,
  foundation: 4,
  frame: 6,
  completion: 1,
};

export interface ConstructionPhaseDefinition {
  readonly laborRequired: number;
  readonly maxWorkers: number;
}

/**
 * Default labor contracts. The default phase durations are the result of
 * dividing labor by the maximum staff: 2/1, 3/1, 8/2, 18/3, and 2/2.
 */
export const CONSTRUCTION_PHASE_DEFINITIONS: Readonly<
  Record<ConstructionPhase, ConstructionPhaseDefinition>
> = {
  survey: { laborRequired: 2, maxWorkers: 1 },
  blueprint: { laborRequired: 3, maxWorkers: 1 },
  foundation: { laborRequired: 8, maxWorkers: 2 },
  frame: { laborRequired: 18, maxWorkers: 3 },
  completion: { laborRequired: 2, maxWorkers: 2 },
};

export interface ConstructionAssignmentCandidate {
  readonly projectId: string;
  /** Number of logical movement edges in the candidate route. */
  readonly routeLength: number;
  /** Stable index into the project's detached staging-cell array. */
  readonly stagingIndex: number;
  readonly citizenId: string;
}

/**
 * Construction assignment order is project, shortest route, staging cell,
 * then citizen ID. The comparator is independent of citizen storage order.
 */
export function compareConstructionAssignments(
  left: ConstructionAssignmentCandidate,
  right: ConstructionAssignmentCandidate,
): number {
  if (left.projectId !== right.projectId) return left.projectId < right.projectId ? -1 : 1;
  if (left.routeLength !== right.routeLength) return left.routeLength - right.routeLength;
  if (left.stagingIndex !== right.stagingIndex) return left.stagingIndex - right.stagingIndex;
  if (left.citizenId !== right.citizenId) return left.citizenId < right.citizenId ? -1 : 1;
  return 0;
}

export function constructionPhaseMaxWorkers(phase: ConstructionPhase): number {
  return CONSTRUCTION_PHASE_DEFINITIONS[phase].maxWorkers;
}

/**
 * Configured durations remain useful as full-staff target durations. Defaults
 * match the labor contract; an override scales required labor by the phase's
 * worker cap so focused tests and balance scenarios can keep short targets.
 */
export function constructionPhaseLaborRequired(
  phase: ConstructionPhase,
  targetDurations: Readonly<
    Record<ConstructionPhase, number>
  > = DEFAULT_CONSTRUCTION_PHASE_DURATIONS,
): number {
  return constructionPhaseMaxWorkers(phase) * targetDurations[phase];
}

export function constructionPhaseFullStaffDuration(
  phase: ConstructionPhase,
  targetDurations: Readonly<
    Record<ConstructionPhase, number>
  > = DEFAULT_CONSTRUCTION_PHASE_DURATIONS,
): number {
  return targetDurations[phase];
}

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
