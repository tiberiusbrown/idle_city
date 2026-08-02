import { describe, expect, it } from 'vitest';
import { footprintCells, isInsideFootprint, createSimulation } from '../src/index';

describe('chunked city integration', () => {
  it('runs for thousands of ticks while preserving chunk, footprint, and determinism invariants', () => {
    const run = (): string => {
      const simulation = createSimulation({
        chunkSize: 8,
        initialChunkRegion: { minX: -1, minY: -1, width: 4, height: 4 },
        homePosition: { x: -6, y: -6 },
        workplacePosition: { x: 18, y: 18 },
        seed: 456,
        citizenCount: 20,
      });
      for (let tick = 0; tick < 2_000; tick += 1) {
        simulation.step();
        if (tick % 97 !== 0) continue;
        const snapshot = simulation.getSnapshot();
        const buildingIds = new Set(snapshot.buildings.map((building) => building.id));
        const interiors = snapshot.buildings.flatMap((building) =>
          footprintCells(building.footprint),
        );
        for (const citizen of snapshot.citizens) {
          expect(
            snapshot.activeChunks.some(
              (chunk) =>
                chunk.chunk.x === Math.floor(citizen.position.x / snapshot.chunkSize) &&
                chunk.chunk.y === Math.floor(citizen.position.y / snapshot.chunkSize),
            ),
          ).toBe(true);
          expect(buildingIds.has(citizen.homeBuildingId)).toBe(true);
          expect(buildingIds.has(citizen.workplaceBuildingId)).toBe(true);
          expect(
            interiors.some((position) =>
              isInsideFootprint(citizen.position, {
                x: position.x,
                y: position.y,
                width: 1,
                height: 1,
              }),
            ),
          ).toBe(false);
          for (let index = 1; index < citizen.route.length; index += 1) {
            const previous = citizen.route[index - 1];
            const current = citizen.route[index];
            if (previous === undefined || current === undefined) {
              throw new Error('Route indexes must resolve during invariant checks.');
            }
            expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
          }
        }
      }
      return simulation.getDeterminismHash();
    };
    expect(run()).toBe(run());
  }, 30_000);

  it('activates sparse outward chunks without filling the bounding box', () => {
    const simulation = createSimulation({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 1, height: 1 },
      activeChunkLimit: 10,
      workplacePosition: { x: 5, y: 5 },
    });
    for (let x = 1; x <= 5; x += 1)
      expect(simulation.activateChunk({ x, y: 0 }).accepted).toBe(true);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.activeChunkCount).toBe(6);
    expect(snapshot.activeChunks).toHaveLength(6);
    expect(snapshot.demand.chunks).toHaveLength(6);
    expect(snapshot.structural.allocatedDemandBuffers).toBe(6);
  });
});
