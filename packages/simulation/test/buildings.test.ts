import { describe, expect, it } from 'vitest';
import {
  BUILDING_ARCHETYPES,
  createBuildingShape,
  enumerateUniqueBuildingTransforms,
  enumerateUniqueShapeTransforms,
  type BuildingGeometry,
  type BuildingPlacementRequest,
  validateBuildingPlacement,
} from '../src/index';

const livingZone = {
  type: 'living' as const,
  rect: { x: 0, y: 0, width: 13, height: 13 },
};

function houseGeometry(origin: { x: number; y: number }): BuildingGeometry {
  const result = {
    archetype: BUILDING_ARCHETYPES['single-house'],
    zone: livingZone,
    origin,
  } satisfies BuildingPlacementRequest;
  const validation = validateBuildingPlacement(result);
  if (!validation.valid) throw new Error(`Expected valid geometry; received ${validation.reason}.`);
  return validation.geometry;
}

const geometryCases: readonly {
  readonly name: string;
  readonly request: BuildingPlacementRequest;
  readonly valid: boolean;
  readonly reason?: string;
}[] = [
  {
    name: 'valid house',
    request: {
      archetype: BUILDING_ARCHETYPES['single-house'],
      zone: livingZone,
      origin: { x: 2, y: 2 },
    },
    valid: true,
  },
  {
    name: 'physical and exclusion conflict',
    request: {
      archetype: BUILDING_ARCHETYPES['single-house'],
      zone: livingZone,
      origin: { x: 4, y: 2 },
      existingBuildings: [houseGeometry({ x: 2, y: 2 })],
    },
    valid: false,
    reason: 'physical-exclusion-overlap',
  },
  {
    name: 'exclusion overlap is allowed',
    request: {
      archetype: BUILDING_ARCHETYPES['single-house'],
      zone: livingZone,
      origin: { x: 5, y: 2 },
      existingBuildings: [houseGeometry({ x: 2, y: 2 })],
    },
    valid: true,
  },
  {
    name: 'exclusion containment',
    request: {
      archetype: BUILDING_ARCHETYPES['single-house'],
      zone: livingZone,
      origin: { x: 0, y: 0 },
    },
    valid: false,
    reason: 'exclusion-outside-zone',
  },
  {
    name: 'citizen occupancy',
    request: {
      archetype: BUILDING_ARCHETYPES['single-house'],
      zone: livingZone,
      origin: { x: 2, y: 2 },
      citizens: [{ x: 2, y: 2 }],
    },
    valid: false,
    reason: 'citizen-occupies-physical-cell',
  },
];

describe('building geometry', () => {
  it.each(geometryCases)('$name', ({ request, valid, reason }) => {
    const result = validateBuildingPlacement(request);
    expect(result.valid).toBe(valid);
    if (!valid && reason !== undefined) expect(result).toEqual({ valid: false, reason });
  });

  it.each([
    ['single house', BUILDING_ARCHETYPES['single-house'], 1],
    ['small shop', BUILDING_ARCHETYPES['small-shop'], 1],
    ['small park', BUILDING_ARCHETYPES['small-park'], 1],
    [
      'asymmetric shape',
      createBuildingShape([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 2, y: 1 },
      ]),
      8,
    ],
  ])('%s has unique stable transforms', (_name, value, expectedCount) => {
    const transforms =
      'physicalShape' in value
        ? enumerateUniqueBuildingTransforms(value.physicalShape, value.exclusionShape)
        : enumerateUniqueShapeTransforms(value);
    expect(transforms).toHaveLength(expectedCount);
    expect(new Set(transforms).size).toBe(expectedCount);
  });
});
