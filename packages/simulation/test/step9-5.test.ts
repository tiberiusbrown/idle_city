import { describe, expect, it } from 'vitest';
import {
  calculateDistrictSeedInfluence,
  buildingClearanceZone,
  buildingClearanceZoneCells,
  createChunkSpatialStore,
  createSimulation,
  enumerateDistrictSeedInfluenceCells,
  isExteriorEntrance,
  isInsideFootprint,
  stagingCapableClearanceZoneCells,
} from '../src/index';

describe('Step 10.5 square seeds and clearance contracts', () => {
  it('uses fixed radii and exact square coverage independent of chunk size', () => {
    const radii = [8, 16, 32].map((chunkSize) => {
      const simulation = createSimulation({
        chunkSize,
        initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
        startingData: 100,
        citizenCount: 0,
      });
      return simulation.getDistrictSeedDefinitions().map(({ kind, influenceRadius }) => ({
        kind,
        influenceRadius,
        sideLength: simulation.getDistrictSeedDefinition(kind).sideLength,
        previewRadius: simulation.getDistrictSeedPlacementInfo({
          kind,
          position: { x: 1, y: 1 },
        }).radius,
      }));
    });
    expect(radii).toEqual(
      Array.from({ length: 3 }, () => [
        { kind: 'living', influenceRadius: 10, sideLength: 21, previewRadius: 10 },
        { kind: 'working', influenceRadius: 12, sideLength: 25, previewRadius: 12 },
        { kind: 'services', influenceRadius: 8, sideLength: 17, previewRadius: 8 },
      ]),
    );

    expect(enumerateDistrictSeedInfluenceCells({ x: 0, y: 0 }, 'living')).toHaveLength(441);
    expect(enumerateDistrictSeedInfluenceCells({ x: 0, y: 0 }, 'working')).toHaveLength(625);
    expect(enumerateDistrictSeedInfluenceCells({ x: 0, y: 0 }, 'services')).toHaveLength(289);
    const livingSeed = [{ id: 'living-1', kind: 'living' as const, position: { x: 0, y: 0 } }];
    expect(
      calculateDistrictSeedInfluence({
        seeds: livingSeed,
        position: { x: 10, y: 0 },
        kind: 'living',
      }),
    ).toBeCloseTo(1 / 11, 6);
    expect(
      calculateDistrictSeedInfluence({
        seeds: livingSeed,
        position: { x: 5, y: 0 },
        kind: 'living',
      }),
    ).toBeCloseTo(6 / 11, 6);
    expect(
      calculateDistrictSeedInfluence({
        seeds: [
          ...livingSeed,
          { id: 'living-2', kind: 'living' as const, position: { x: 5, y: 0 } },
        ],
        position: { x: 5, y: 0 },
        kind: 'living',
      }),
    ).toBe(1);
  });

  it('reports exact preview coverage without spending Data and revalidates stale confirmation', () => {
    const simulation = createSimulation({ startingData: 100, citizenCount: 0 });
    const before = simulation.getSnapshot();
    const hashBefore = simulation.getDeterminismHash();
    const candidate = simulation.getDistrictSeedPlacementInfo({
      kind: 'living',
      position: { x: 6, y: 6 },
    });
    expect(candidate.valid).toBe(true);
    expect(candidate.radius).toBe(simulation.getDistrictSeedDefinition('living').influenceRadius);
    expect(candidate.cost).toBe(10);
    expect(candidate.sideLength).toBe(21);
    expect(candidate.coveredCellCount).toBe(441);
    expect(simulation.getSnapshot()).toEqual(before);
    expect(simulation.getDeterminismHash()).toBe(hashBefore);

    const first = simulation.placeDistrictSeed({ kind: 'living', position: candidate.position });
    expect(first).toMatchObject({ accepted: true, cost: 10 });
    const afterFirst = simulation.getSnapshot();
    const afterFirstHash = simulation.getDeterminismHash();
    expect(simulation.placeDistrictSeed({ kind: 'living', position: candidate.position })).toEqual({
      accepted: false,
      reason: 'occupied',
    });
    expect(simulation.getSnapshot()).toEqual(afterFirst);
    expect(simulation.getDeterminismHash()).toBe(afterFirstHash);
    expect(simulation.getSnapshot().data).toBe(90);
  });

  it('distinguishes active coverage at a signed-world boundary', () => {
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      startingData: 100,
      citizenCount: 0,
    });
    const info = simulation.getDistrictSeedPlacementInfo({
      kind: 'living',
      position: { x: 15, y: 1 },
    });
    expect(info.coveredCellCount).toBe(441);
    expect(info.activeCoveredCellCount).toBeGreaterThan(0);
    expect(info.inactiveCoveredCellCount).toBe(info.coveredCellCount - info.activeCoveredCellCount);
    expect(info.activeCoveredCellCount).toBeLessThan(info.coveredCellCount);
  });

  it('keeps active empty land walkable/buildable and blocks footprints', () => {
    const store = createChunkSpatialStore(8);
    store.activate({ x: 0, y: 0 });
    expect(store.isWalkable({ x: 2, y: 2 })).toBe(true);
    expect(store.isBuildable({ x: 2, y: 2 })).toBe(true);
    store.block({ x: 2, y: 2 });
    expect(store.isWalkable({ x: 2, y: 2 })).toBe(false);
    expect(store.isBuildable({ x: 2, y: 2 })).toBe(false);
    expect(store.getStaticTopologyRevision({ x: 0, y: 0 })).toBe(1);
  });

  it('enumerates one-cell clearance zones and requires stable staging capacity', () => {
    const footprint = { x: 2, y: 2, width: 3, height: 3 } as const;
    const clearanceZone = buildingClearanceZone(footprint);
    const cells = buildingClearanceZoneCells(footprint);
    expect(clearanceZone).toEqual({ x: 1, y: 1, width: 5, height: 5 });
    expect(cells).toHaveLength(16);
    expect(cells).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
      { x: 1, y: 2 },
      { x: 5, y: 2 },
      { x: 1, y: 3 },
      { x: 5, y: 3 },
      { x: 1, y: 4 },
      { x: 5, y: 4 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(cells.every((cell) => !isInsideFootprint(cell, footprint))).toBe(true);
    const overlappingZone = buildingClearanceZoneCells({ x: 6, y: 2, width: 3, height: 3 });
    expect(
      overlappingZone.some((cell) =>
        cells.some((other) => other.x === cell.x && other.y === cell.y),
      ),
    ).toBe(true);
    const store = createChunkSpatialStore(8);
    store.activate({ x: 0, y: 0 });
    expect(cells.every((cell) => store.isWalkable(cell) && store.isBuildable(cell))).toBe(true);
    const staging = stagingCapableClearanceZoneCells(footprint, {
      isActive: () => true,
      isWalkable: (cell) => !isInsideFootprint(cell, footprint),
    });
    expect(staging.length).toBeGreaterThanOrEqual(3);
    expect(staging.some((cell) => isExteriorEntrance(cell, footprint))).toBe(true);
  });
});
