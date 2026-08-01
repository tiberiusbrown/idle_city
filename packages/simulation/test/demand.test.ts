import { describe, expect, it } from 'vitest';
import { calculateCityDemand, createSimulation, type Building } from '../src/index';

const buildings: readonly Building[] = [
  {
    id: 'home',
    type: 'home',
    footprint: { x: 2, y: 2, width: 3, height: 3 },
    entrance: { x: 2, y: 1 },
    capacity: 1,
  },
  {
    id: 'work',
    type: 'workplace',
    footprint: { x: 10, y: 10, width: 5, height: 5 },
    entrance: { x: 10, y: 9 },
    capacity: 1,
  },
];

describe('chunked spatial demand', () => {
  it('keeps ordinary snapshots to totals and stable chunk summaries', () => {
    const snapshot = createSimulation({ seed: 42 }).getSnapshot();
    expect('cells' in snapshot.demand).toBe(false);
    expect(snapshot.demand.chunks).toHaveLength(snapshot.activeChunkCount);
    expect(snapshot.demand.chunks.map((chunk) => chunk.key)).toEqual(
      snapshot.activeChunks.map((chunk) => chunk.key),
    );
    for (const chunk of snapshot.demand.chunks) {
      expect(chunk.cellCount).toBe(snapshot.chunkSize * snapshot.chunkSize);
      for (const value of Object.values(chunk.totals)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('serves a bounded detached demand-chunk and region query', () => {
    const simulation = createSimulation({ chunkSize: 8, demandQueryMaxCells: 64 });
    const chunk = simulation.getDemandChunk({ x: 0, y: 0 });
    if (chunk === undefined) throw new Error('The initial chunk must be queryable.');
    expect(chunk.cells).toHaveLength(64);
    const original = chunk.cells[0]?.living;
    if (original === undefined) throw new Error('The query must contain a first cell.');
    (chunk.cells[0] as { living: number }).living = 999;
    expect(simulation.getDemandChunk({ x: 0, y: 0 })?.cells[0]?.living).toBe(original);
    expect(simulation.getDemandChunk({ x: -1, y: 0 })).toBeUndefined();
    expect(simulation.queryDemandRegion({ x: 0, y: 0, width: 8, height: 8 }).cells).toHaveLength(
      64,
    );
    expect(() => simulation.queryDemandRegion({ x: 0, y: 0, width: 9, height: 8 })).toThrow(
      /limit/,
    );
  });

  it('dirties only the local active demand chunk for a small-radius seed', () => {
    const simulation = createSimulation({
      startingData: 10,
      demandInfluenceRadius: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
    });
    const before = simulation.getSnapshot();
    const beforeRevisions = new Map(
      before.demand.chunks.map((chunk) => [chunk.key, chunk.revision]),
    );
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 5 } }).accepted,
    ).toBe(true);
    const after = simulation.getSnapshot();
    const changed = after.demand.chunks
      .filter((chunk) => chunk.revision !== beforeRevisions.get(chunk.key))
      .map((chunk) => chunk.key);
    expect(changed).toEqual(['0:0']);
    expect(after.structural.demandChunksEvaluated).toBe(
      before.structural.demandChunksEvaluated + 1,
    );
  });

  it('is reproducible for the same chunk configuration', () => {
    const configuration = {
      chunkSize: 8,
      initialChunkRegion: { minX: -1, minY: -1, width: 3, height: 3 },
      seed: 9876,
      citizenCount: 4,
      housingCapacity: 2,
      workplaceCapacity: 3,
      homePosition: { x: -6, y: -6 },
      workplacePosition: { x: 10, y: 10 },
    } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    for (let tick = 0; tick < 75; tick += 1) {
      left.step();
      right.step();
    }
    expect(left.getSnapshot().demand).toEqual(right.getSnapshot().demand);
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
  });

  it('retains the pure bounded-grid demand helper for analysis', () => {
    const demand = calculateCityDemand({
      width: 6,
      height: 5,
      buildings,
      citizens: [{ homeBuildingId: 'home', workplaceBuildingId: 'work' }],
      metrics: { space: 1, access: 1, activity: 0 },
    });
    expect(demand.cells).toHaveLength(30);
    expect(demand.cells.map((cell) => cell.position)).toEqual(
      Array.from({ length: 30 }, (_, index) => ({ x: index % 6, y: Math.floor(index / 6) })),
    );
  });

  it('rejects non-finite seed influence in pure demand calculations', () => {
    expect(() =>
      calculateCityDemand({
        width: 5,
        height: 5,
        buildings,
        citizens: [{ homeBuildingId: 'home', workplaceBuildingId: 'work' }],
        metrics: { space: 1, access: 1, activity: 0 },
        seedInfluence: () => Number.NaN,
      }),
    ).toThrow(/finite/);
  });
});
