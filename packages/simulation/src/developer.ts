import type {
  BuildingType,
  DevelopmentCandidate,
  DevelopmentReason,
  DevelopmentReasonCode,
} from './types';

export const DEVELOPMENT_BUILDING_TYPE_ORDER: readonly BuildingType[] = ['home', 'workplace'];

export const DEVELOPMENT_SCORE_PRECISION = 1_000_000;

/**
 * Developer scoring weights. Every input is normalized to [0, 1]. The score
 * is rounded to six decimal places after applying these weights:
 *
 *   0.30 local demand
 * + 0.35 matching seed influence
 * + 0.10 complementary use
 * + 0.10 entrance accessibility
 * + 0.15 expected access improvement
 * - 0.15 same-use saturation
 * - 0.05 construction cost
 *
 * `spatialFactor` is separately reported as 0.6 entrance accessibility plus
 * 0.4 expected access improvement. No random input is used.
 */
export const DEVELOPMENT_SCORE_WEIGHTS = {
  localMatchingDemand: 0.3,
  matchingSeedInfluence: 0.35,
  complementaryUse: 0.1,
  entranceAccessibility: 0.1,
  expectedAccessImprovement: 0.15,
  sameUseSaturation: -0.15,
  constructionCost: -0.05,
} as const;

export interface DevelopmentScoreInput {
  readonly buildingType: BuildingType;
  readonly localMatchingDemand: number;
  readonly seedInfluence: number;
  readonly complementaryUse: number;
  readonly entranceAccessibility: number;
  readonly expectedAccessImprovement: number;
  readonly sameUseSaturation: number;
  readonly constructionCost: number;
}

export interface DevelopmentScoreResult {
  readonly score: number;
  readonly primaryReason: DevelopmentReason;
  readonly spatialFactor: number;
}

function round(value: number): number {
  return Math.round(value * DEVELOPMENT_SCORE_PRECISION) / DEVELOPMENT_SCORE_PRECISION;
}

function normalized(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite value between 0 and 1.`);
  }
  return value;
}

function noun(buildingType: BuildingType): string {
  return buildingType === 'home' ? 'home' : 'workplace';
}

function reasonText(code: DevelopmentReasonCode, buildingType: BuildingType): string {
  const building = noun(buildingType);
  switch (code) {
    case 'matching-seed-influence':
      return `A matching district seed is influencing this ${building} site.`;
    case 'local-matching-demand':
      return `Local demand for ${building} capacity is high.`;
    case 'complementary-use':
      return `This site is close to a complementary use.`;
    case 'access-improvement':
      return `This site improves planned access between homes and workplaces.`;
    case 'entrance-accessibility':
      return `The site has an accessible entrance from the existing city.`;
  }
}

/** Pure deterministic score calculation used by developer evaluation. */
export function scoreDevelopmentCandidate(input: DevelopmentScoreInput): DevelopmentScoreResult {
  const localMatchingDemand = normalized('localMatchingDemand', input.localMatchingDemand);
  const seedInfluence = normalized('seedInfluence', input.seedInfluence);
  const complementaryUse = normalized('complementaryUse', input.complementaryUse);
  const entranceAccessibility = normalized('entranceAccessibility', input.entranceAccessibility);
  const expectedAccessImprovement = normalized(
    'expectedAccessImprovement',
    input.expectedAccessImprovement,
  );
  const sameUseSaturation = normalized('sameUseSaturation', input.sameUseSaturation);
  const constructionCost = normalized('constructionCost', input.constructionCost);

  const contributions: readonly {
    readonly code: DevelopmentReasonCode;
    readonly value: number;
  }[] = [
    {
      code: 'matching-seed-influence',
      value: DEVELOPMENT_SCORE_WEIGHTS.matchingSeedInfluence * seedInfluence,
    },
    {
      code: 'local-matching-demand',
      value: DEVELOPMENT_SCORE_WEIGHTS.localMatchingDemand * localMatchingDemand,
    },
    {
      code: 'complementary-use',
      value: DEVELOPMENT_SCORE_WEIGHTS.complementaryUse * complementaryUse,
    },
    {
      code: 'access-improvement',
      value: DEVELOPMENT_SCORE_WEIGHTS.expectedAccessImprovement * expectedAccessImprovement,
    },
    {
      code: 'entrance-accessibility',
      value: DEVELOPMENT_SCORE_WEIGHTS.entranceAccessibility * entranceAccessibility,
    },
  ];
  let primary = contributions[0];
  for (const contribution of contributions.slice(1)) {
    if (contribution.value > (primary?.value ?? Number.NEGATIVE_INFINITY)) primary = contribution;
  }
  if (primary === undefined) throw new Error('A development reason is required.');

  const rawScore =
    DEVELOPMENT_SCORE_WEIGHTS.localMatchingDemand * localMatchingDemand +
    DEVELOPMENT_SCORE_WEIGHTS.matchingSeedInfluence * seedInfluence +
    DEVELOPMENT_SCORE_WEIGHTS.complementaryUse * complementaryUse +
    DEVELOPMENT_SCORE_WEIGHTS.entranceAccessibility * entranceAccessibility +
    DEVELOPMENT_SCORE_WEIGHTS.expectedAccessImprovement * expectedAccessImprovement +
    DEVELOPMENT_SCORE_WEIGHTS.sameUseSaturation * sameUseSaturation +
    DEVELOPMENT_SCORE_WEIGHTS.constructionCost * constructionCost;

  return {
    score: round(Math.max(0, Math.min(1, rawScore))),
    primaryReason: {
      code: primary.code,
      text: reasonText(primary.code, input.buildingType),
      scoreContribution: round(primary.value),
    },
    spatialFactor: round(0.6 * entranceAccessibility + 0.4 * expectedAccessImprovement),
  };
}

export function compareDevelopmentBuildingTypes(left: BuildingType, right: BuildingType): number {
  return (
    DEVELOPMENT_BUILDING_TYPE_ORDER.indexOf(left) - DEVELOPMENT_BUILDING_TYPE_ORDER.indexOf(right)
  );
}

/**
 * Stable candidate ranking. This is intentionally separate from score
 * calculation so tie-breaking cannot depend on object or map iteration.
 */
export function compareDevelopmentCandidates(
  left: DevelopmentCandidate,
  right: DevelopmentCandidate,
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.seedInfluence !== right.seedInfluence) return right.seedInfluence - left.seedInfluence;
  if (left.expectedAccessImprovement !== right.expectedAccessImprovement) {
    return right.expectedAccessImprovement - left.expectedAccessImprovement;
  }
  if (left.footprint.y !== right.footprint.y) return left.footprint.y - right.footprint.y;
  if (left.footprint.x !== right.footprint.x) return left.footprint.x - right.footprint.x;
  const buildingTypeOrder = compareDevelopmentBuildingTypes(left.buildingType, right.buildingType);
  if (buildingTypeOrder !== 0) return buildingTypeOrder;
  return left.entranceOrder - right.entranceOrder;
}
