import { describe, expect, it } from 'vitest';
import {
  BUILDING_FOOTPRINTS,
  chunkCoordinateForPosition,
  createChunkSpatialStore,
  createSimulation,
  exteriorEntranceCandidates,
  footprintCells,
  isExteriorEntrance,
  isInsideFootprint,
  localCoordinateForPosition,
  selectExteriorEntrance,
} from '../src/index';

describe('signed chunk storage and building footprints', () => {
  it('creates the deterministic default 4 by 4 active region', () => {
    const left = createSimulation().getSnapshot();
    const right = createSimulation().getSnapshot();
    expect(left.activeChunks).toEqual(right.activeChunks);
    expect(left.activeChunks.map((chunk) => chunk.key)).toEqual(
      Array.from(
        { length: 16 },
        (_, index) => `${String(index % 4)}:${String(Math.floor(index / 4))}`,
      ),
    );
  });

  it('uses floor-based negative coordinate conversion at boundaries', () => {
    expect(chunkCoordinateForPosition({ x: 0, y: 0 }, 32)).toEqual({ x: 0, y: 0 });
    expect(chunkCoordinateForPosition({ x: 31, y: -1 }, 32)).toEqual({ x: 0, y: -1 });
    expect(chunkCoordinateForPosition({ x: -1, y: -32 }, 32)).toEqual({ x: -1, y: -1 });
    expect(localCoordinateForPosition({ x: -1, y: -33 }, 32)).toEqual({ x: 31, y: 31 });
  });

  it('allocates only occupied chunk buffers and keeps stable revisions', () => {
    const store = createChunkSpatialStore(4);
    store.activate({ x: 0, y: 0 });
    store.activate({ x: 3, y: 3 });
    expect(store.getAllocatedOccupancyBufferCount()).toBe(0);
    expect(store.isWalkable({ x: 0, y: 0 })).toBe(true);
    store.block({ x: 0, y: 0 });
    expect(store.getAllocatedOccupancyBufferCount()).toBe(1);
    expect(store.getChunkRevision({ x: 0, y: 0 })).toBe(1);
    store.block({ x: 0, y: 0 });
    expect(store.getChunkRevision({ x: 0, y: 0 })).toBe(1);
    expect(store.isWalkable({ x: 12, y: 12 })).toBe(true);
    expect(store.isWalkable({ x: 4, y: 0 })).toBe(false);
  });

  it('defines exact homes, multi-cell workplaces, cross-chunk cells, and exterior entrances', () => {
    expect(BUILDING_FOOTPRINTS.home).toEqual({ width: 3, height: 3 });
    expect(BUILDING_FOOTPRINTS.workplace).toEqual({ width: 5, height: 5 });
    const footprint = { x: 3, y: 3, width: 5, height: 5 };
    const cells = footprintCells(footprint);
    expect(cells).toHaveLength(25);
    expect(cells[0]).toEqual({ x: 3, y: 3 });
    expect(cells.at(-1)).toEqual({ x: 7, y: 7 });
    const entrance = selectExteriorEntrance(footprint, {
      isActive: () => true,
      isWalkable: () => true,
    });
    expect(isExteriorEntrance(entrance, footprint)).toBe(true);
    expect(isInsideFootprint(entrance, footprint)).toBe(false);
    expect(exteriorEntranceCandidates(footprint)[0]).toEqual({ x: 3, y: 2 });

    const simulation = createSimulation({
      chunkSize: 4,
      initialChunkRegion: { minX: 0, minY: 0, width: 3, height: 3 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 3, y: 7 },
    });
    const snapshot = simulation.getSnapshot();
    const workplace = snapshot.buildings.find((building) => building.type === 'workplace');
    if (workplace === undefined) throw new Error('A workplace is required.');
    expect(workplace.footprint).toEqual({ x: 3, y: 7, width: 5, height: 5 });
    expect(
      new Set(footprintCells(workplace.footprint).map((cell) => Math.floor(cell.x / 4))).size,
    ).toBe(2);
    expect(isExteriorEntrance(workplace.entrance, workplace.footprint)).toBe(true);
  });
});
