import {
  createGridPosition,
  stableHash,
  type GridPosition,
  type GridRect,
} from '@idle-city/shared';
import {
  validateBuildingPlacement,
  type BuildingArchetype,
  type BuildingArchetypeId,
  type BuildingGeometry,
  type BuildingPlacementCitizen,
  type BuildingPlacementValidation,
  type BuildingTransform,
  type ExistingBuildingGeometry,
} from './buildings';
import { createAStarSearch } from './pathfinding';
import type { ZoneType } from './index';

export const DEFAULT_PLANNING_CHANCE = 0.02;

export interface PlanningZoneGeometry {
  readonly type: ZoneType;
  readonly rect: GridRect;
}

function positionKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInsideRect(position: GridPosition, rect: GridRect): boolean {
  return (
    position.x >= rect.x &&
    position.y >= rect.y &&
    position.x < rect.x + rect.width &&
    position.y < rect.y + rect.height
  );
}

/** Returns a deterministic unit value without consuming shared random state. */
export function keyedPlanningUnit(key: unknown): number {
  const integer = Number.parseInt(stableHash(key), 16);
  return (integer + 1) / 0x1_0000_0001;
}

/** Counts each exclusion cell once, even when several exclusions overlap. */
export function calculateZoneFreeSpaceRatio(
  zone: PlanningZoneGeometry,
  buildings: readonly ExistingBuildingGeometry[],
): number {
  const coveredCells = new Set<string>();
  for (const building of buildings) {
    for (const cell of building.exclusionCells) {
      if (isInsideRect(cell, zone.rect)) coveredCells.add(positionKey(cell));
    }
  }

  const totalCells = zone.rect.width * zone.rect.height;
  return Math.min(1, Math.max(0, (totalCells - coveredCells.size) / totalCells));
}

/** Calculates the configured planning chance for one zone opportunity. */
export function calculatePlanningChance(
  freeSpaceRatio: number,
  coefficient = DEFAULT_PLANNING_CHANCE,
): number {
  const normalizedRatio = Math.min(1, Math.max(0, freeSpaceRatio));
  const normalizedCoefficient = Math.min(1, Math.max(0, coefficient));
  return Math.min(1, Math.max(0, normalizedCoefficient * normalizedRatio));
}

export function planningRollSucceeds(options: {
  readonly seed: number;
  readonly tick: number;
  readonly zoneId: string;
  readonly planningSequence: number;
  readonly chance: number;
}): boolean {
  return (
    keyedPlanningUnit({
      seed: options.seed,
      tick: options.tick,
      zoneId: options.zoneId,
      planningSequence: options.planningSequence,
      purpose: 'building-planning-roll',
    }) < options.chance
  );
}

function compareKeyedValues(
  leftKey: string,
  rightKey: string,
  leftTieBreak: string,
  rightTieBreak: string,
): number {
  return compareStrings(leftKey, rightKey) || compareStrings(leftTieBreak, rightTieBreak);
}

/** Orders supported transforms using a keyed, stable per-job permutation. */
export function orderPlanningTransforms(options: {
  readonly seed: number;
  readonly zoneId: string;
  readonly planningSequence: number;
  readonly archetype: BuildingArchetype;
}): readonly BuildingTransform[] {
  return Object.freeze(
    [...options.archetype.supportedTransforms].sort((left, right) => {
      const leftKey = stableHash({
        seed: options.seed,
        zoneId: options.zoneId,
        planningSequence: options.planningSequence,
        archetypeId: options.archetype.id,
        purpose: 'building-planning-transform-order',
        transform: left,
      });
      const rightKey = stableHash({
        seed: options.seed,
        zoneId: options.zoneId,
        planningSequence: options.planningSequence,
        archetypeId: options.archetype.id,
        purpose: 'building-planning-transform-order',
        transform: right,
      });
      return compareKeyedValues(leftKey, rightKey, left, right);
    }),
  );
}

/** Enumerates every zone cell as a possible origin, then applies keyed ordering. */
export function orderPlanningAnchors(options: {
  readonly seed: number;
  readonly zoneId: string;
  readonly planningSequence: number;
  readonly archetypeId: BuildingArchetypeId;
  readonly rect: GridRect;
}): readonly GridPosition[] {
  const anchors: GridPosition[] = [];
  for (let y = options.rect.y; y < options.rect.y + options.rect.height; y += 1) {
    for (let x = options.rect.x; x < options.rect.x + options.rect.width; x += 1) {
      anchors.push(createGridPosition(x, y));
    }
  }

  anchors.sort((left, right) => {
    const leftKey = stableHash({
      seed: options.seed,
      zoneId: options.zoneId,
      planningSequence: options.planningSequence,
      archetypeId: options.archetypeId,
      purpose: 'building-planning-anchor-order',
      anchor: left,
    });
    const rightKey = stableHash({
      seed: options.seed,
      zoneId: options.zoneId,
      planningSequence: options.planningSequence,
      archetypeId: options.archetypeId,
      purpose: 'building-planning-anchor-order',
      anchor: right,
    });
    return compareKeyedValues(leftKey, rightKey, positionKey(left), positionKey(right));
  });

  return Object.freeze(anchors);
}

function canReachCell(options: {
  readonly citizen: BuildingPlacementCitizen;
  readonly target: GridPosition;
  readonly targetCells: ReadonlySet<string>;
  readonly blockedCells: ReadonlySet<string>;
  readonly sourceCells: ReadonlySet<string>;
}): boolean {
  const source = 'position' in options.citizen ? options.citizen.position : options.citizen;
  const sourceKey = positionKey(source);
  const search = createAStarSearch({
    start: source,
    goal: options.target,
    isWalkable: (position) => {
      const key = positionKey(position);
      return (
        key === sourceKey ||
        options.sourceCells.has(key) ||
        options.targetCells.has(key) ||
        !options.blockedCells.has(key)
      );
    },
  });
  return search.advance(Number.MAX_SAFE_INTEGER).status === 'found';
}

/** Checks static topology only; citizens are not treated as permanent obstacles. */
export function canReachBuildingFootprint(
  geometry: BuildingGeometry,
  citizens: readonly BuildingPlacementCitizen[],
  existingBuildings: readonly ExistingBuildingGeometry[],
): boolean {
  const targetCells = new Set(geometry.physicalCells.map(positionKey));
  const blockedCells = new Set<string>();
  for (const building of existingBuildings) {
    for (const cell of building.physicalCells) blockedCells.add(positionKey(cell));
  }

  for (const citizen of citizens) {
    const source = 'position' in citizen ? citizen.position : citizen;
    const sourceKey = positionKey(source);
    const sourceCells = new Set<string>();
    for (const building of existingBuildings) {
      if (!building.physicalCells.some((cell) => positionKey(cell) === sourceKey)) continue;
      for (const cell of building.physicalCells) sourceCells.add(positionKey(cell));
    }
    for (const target of geometry.physicalCells) {
      if (canReachCell({ citizen, target, targetCells, blockedCells, sourceCells })) return true;
    }
  }
  return false;
}

/** Reuses pure geometry validation and adds the planner's reachability gate. */
export function validatePlanningCandidate(options: {
  readonly archetype: BuildingArchetype;
  readonly zone: PlanningZoneGeometry;
  readonly origin: GridPosition;
  readonly transform: BuildingTransform;
  readonly existingBuildings: readonly ExistingBuildingGeometry[];
  readonly citizens: readonly BuildingPlacementCitizen[];
}): Extract<BuildingPlacementValidation, { readonly valid: true }> | null {
  const validation = validateBuildingPlacement({
    archetype: options.archetype,
    zone: options.zone,
    origin: options.origin,
    transform: options.transform,
    existingBuildings: options.existingBuildings,
    citizens: options.citizens,
  });
  if (!validation.valid) return null;
  if (
    !canReachBuildingFootprint(validation.geometry, options.citizens, options.existingBuildings)
  ) {
    return null;
  }
  return validation;
}

export function comparePlanningZoneIds(left: string, right: string): number {
  return compareStrings(left, right);
}
