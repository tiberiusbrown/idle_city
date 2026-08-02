import type { Building } from './types';

export const SERVICE_BUILDING_FOOTPRINT = { width: 4, height: 4 } as const;
export const SERVICE_BUILDING_CAPACITY = 8;
export const SERVICE_NEED_MAX = 4;
export const SERVICE_NEED_THRESHOLD = 2;
export const SERVICE_USE_DURATION_TICKS = 2;
export const SERVICES_LOCAL_CAPACITY_RADIUS = 8;
export const SERVICE_DESTINATION_MAX_ROUTE_LENGTH = 64;

export interface ServicesDemandInput {
  readonly serviceNeedPressure: number;
  readonly serviceCapacityShortage: number;
  readonly localCapacityCoverage: number;
  readonly enabled?: boolean;
}

export interface ServicesDemandResult {
  readonly needPressureContribution: number;
  readonly capacityShortageContribution: number;
  readonly localCoverageContribution: number;
  readonly value: number;
}

/**
 * Services destination scoring is intentionally small and explicit. Every
 * term is normalized to [0, 1] before this weighted sum is rounded to six
 * decimal places:
 *
 *   0.50 need value
 * + 0.20 available quality
 * - 0.20 route cost
 * - 0.10 expected wait
 *
 * Step 10 has no citizen preferences or service prices, so those terms are
 * deliberately absent rather than represented by a generic planner.
 */
export const SERVICE_DESTINATION_SCORE_WEIGHTS = {
  needValue: 0.5,
  availableQuality: 0.2,
  routeCost: -0.2,
  expectedWait: -0.1,
} as const;

export interface ServiceDestinationScoreInput {
  readonly serviceNeed: number;
  readonly routeLength: number;
  readonly occupancyRatio: number;
}

export interface ServiceDestinationScoreResult {
  readonly score: number;
  readonly needValue: number;
  readonly availableQuality: number;
  readonly routeCost: number;
  readonly expectedWait: number;
  readonly primaryReason: string;
}

export interface ServiceDestinationCandidateInput {
  readonly building: Building;
  readonly routeLength: number;
  readonly occupancyRatio: number;
  readonly score: number;
  readonly primaryReason: string;
}

export interface ServiceDestinationCandidate extends ServiceDestinationCandidateInput {
  readonly building: Building & { readonly type: 'service' };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Services destination terms must be finite.');
  return Math.max(0, Math.min(1, value));
}

/** Calculates the normalized per-cell Services demand pressure. */
export function calculateServicesDemand(input: ServicesDemandInput): ServicesDemandResult {
  const serviceNeedPressure = clampUnit(input.serviceNeedPressure);
  const serviceCapacityShortage = clampUnit(input.serviceCapacityShortage);
  const localCapacityCoverage = clampUnit(input.localCapacityCoverage);
  if (input.enabled === false) {
    return {
      needPressureContribution: 0,
      capacityShortageContribution: 0,
      localCoverageContribution: 0,
      value: 0,
    };
  }
  const needPressureContribution = round(0.55 * 0.6 * serviceNeedPressure);
  const capacityShortageContribution = round(0.55 * 0.4 * serviceCapacityShortage);
  const localCoverageContribution = round(0.45 * (1 - localCapacityCoverage));
  return {
    needPressureContribution,
    capacityShortageContribution,
    localCoverageContribution,
    value: round(
      Math.min(
        1,
        needPressureContribution + capacityShortageContribution + localCoverageContribution,
      ),
    ),
  };
}

function checkedNeed(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > SERVICE_NEED_MAX) {
    throw new Error(`serviceNeed must be an integer in [0, ${String(SERVICE_NEED_MAX)}].`);
  }
  return value;
}

function checkedRouteLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Service route length must be a non-negative safe integer.');
  }
  return value;
}

function primaryReason(
  needValue: number,
  availableQuality: number,
  routeCost: number,
  expectedWait: number,
): string {
  const contributions = [
    {
      value: SERVICE_DESTINATION_SCORE_WEIGHTS.needValue * needValue,
      text: 'Service need is high.',
    },
    {
      value: SERVICE_DESTINATION_SCORE_WEIGHTS.availableQuality * availableQuality,
      text: 'This service has available capacity.',
    },
    {
      value: -SERVICE_DESTINATION_SCORE_WEIGHTS.routeCost * routeCost,
      text: 'This service is nearby.',
    },
    {
      value: -SERVICE_DESTINATION_SCORE_WEIGHTS.expectedWait * expectedWait,
      text: 'This service has a short expected wait.',
    },
  ];
  let best = contributions[0];
  for (const contribution of contributions.slice(1)) {
    if (contribution.value > (best?.value ?? Number.NEGATIVE_INFINITY)) best = contribution;
  }
  return best?.text ?? 'A compatible service destination is available.';
}

/** Calculates the documented deterministic Services destination score. */
export function scoreServiceDestination(
  input: ServiceDestinationScoreInput,
): ServiceDestinationScoreResult {
  const serviceNeed = checkedNeed(input.serviceNeed);
  const routeLength = checkedRouteLength(input.routeLength);
  const occupancyRatio = clampUnit(input.occupancyRatio);
  const needValue = round(serviceNeed / SERVICE_NEED_MAX);
  const availableQuality = round(1 - occupancyRatio);
  const routeCost = round(
    Math.min(1, routeLength / Math.max(1, SERVICE_DESTINATION_MAX_ROUTE_LENGTH)),
  );
  const expectedWait = round(occupancyRatio);
  const score = round(
    Math.max(
      0,
      Math.min(
        1,
        SERVICE_DESTINATION_SCORE_WEIGHTS.needValue * needValue +
          SERVICE_DESTINATION_SCORE_WEIGHTS.availableQuality * availableQuality +
          SERVICE_DESTINATION_SCORE_WEIGHTS.routeCost * routeCost +
          SERVICE_DESTINATION_SCORE_WEIGHTS.expectedWait * expectedWait,
      ),
    ),
  );
  return {
    score,
    needValue,
    availableQuality,
    routeCost,
    expectedWait,
    primaryReason: primaryReason(needValue, availableQuality, routeCost, expectedWait),
  };
}

export function compareServiceDestinations(
  left: ServiceDestinationCandidateInput,
  right: ServiceDestinationCandidateInput,
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.routeLength !== right.routeLength) return left.routeLength - right.routeLength;
  if (left.occupancyRatio !== right.occupancyRatio) {
    return left.occupancyRatio - right.occupancyRatio;
  }
  return left.building.id < right.building.id ? -1 : left.building.id > right.building.id ? 1 : 0;
}

/** Selects a destination from already-filtered completed/reachable candidates. */
export function selectServiceDestination(
  candidates: readonly ServiceDestinationCandidate[],
): ServiceDestinationCandidate | undefined {
  return [...candidates].sort(compareServiceDestinations)[0];
}
