import { describe, expect, it } from 'vitest';
import {
  calculateDistrictSeedInfluence,
  circulationEnvelope,
  circulationEnvelopeCells,
  createChunkSpatialStore,
  createSimulation,
  enumerateDistrictSeedInfluenceCells,
  findTwoCellConnector,
  isExteriorEntrance,
  isInsideFootprint,
  stagingCapableEnvelopeCells,
} from '../src/index';

const activeEverywhere = (position: { readonly x: number; readonly y: number }): boolean =>
  position.x >= 0 && position.x <= 5 && position.y >= 0 && position.y <= 5;

describe('Step 10.5 square seeds and circulation contracts', () => {
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

  it('stores ROW in compact revisions and prevents building consumption', () => {
    const store = createChunkSpatialStore(8);
    store.activate({ x: 0, y: 0 });
    store.markRightOfWay({ x: 2, y: 2 });
    expect(store.isRightOfWay({ x: 2, y: 2 })).toBe(true);
    expect(store.isWalkable({ x: 2, y: 2 })).toBe(true);
    expect(store.isBuildable({ x: 2, y: 2 })).toBe(false);
    expect(store.getRightOfWayRevision({ x: 0, y: 0 })).toBe(1);
    expect(store.getStaticTopologyRevision({ x: 0, y: 0 })).toBe(1);
    expect(store.getAllocatedRightOfWayBufferCount()).toBe(1);
    expect(() => store.block({ x: 2, y: 2 })).toThrow(/right-of-way/);
    store.markRightOfWay({ x: 2, y: 2 });
    expect(store.getRightOfWayRevision({ x: 0, y: 0 })).toBe(1);
  });

  it('enumerates one-cell envelopes and requires stable staging capacity', () => {
    const footprint = { x: 2, y: 2, width: 3, height: 3 } as const;
    const envelope = circulationEnvelope(footprint);
    const cells = circulationEnvelopeCells(footprint);
    expect(envelope).toEqual({ x: 1, y: 1, width: 5, height: 5 });
    expect(cells).toHaveLength(16);
    expect(cells.every((cell) => !isInsideFootprint(cell, footprint))).toBe(true);
    const staging = stagingCapableEnvelopeCells(footprint, {
      isActive: () => true,
      isWalkable: (cell) => !isInsideFootprint(cell, footprint),
    });
    expect(staging.length).toBeGreaterThanOrEqual(3);
    expect(staging.some((cell) => isExteriorEntrance(cell, footprint))).toBe(true);
  });

  it('bootstraps two starter envelopes onto one connected ROW network', () => {
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 0,
    });
    const snapshot = simulation.getSnapshot();
    const row = snapshot.rightOfWay.flatMap((chunk) => chunk.cells);
    expect(row.length).toBeGreaterThan(0);
    expect(snapshot.structural.rightOfWayCells).toBe(row.length);
    const rowKeys = new Set(row.map((cell) => `${String(cell.x)},${String(cell.y)}`));
    expect(
      row.every((cell) =>
        snapshot.activeChunks.some(
          (chunk) =>
            chunk.key ===
            `${String(Math.floor(cell.x / snapshot.chunkSize))}:${String(Math.floor(cell.y / snapshot.chunkSize))}`,
        ),
      ),
    ).toBe(true);
    expect(
      row.every((cell) =>
        snapshot.buildings.every((building) => !isInsideFootprint(cell, building.footprint)),
      ),
    ).toBe(true);
    const pending = [...rowKeys];
    const visited = new Set<string>();
    const first = pending[0];
    if (first === undefined) throw new Error('The starter ROW must not be empty.');
    const queue = [first];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      const [xText, yText] = current.split(',');
      const x = Number(xText);
      const y = Number(yText);
      for (const neighbor of [
        `${String(x + 1)},${String(y)}`,
        `${String(x - 1)},${String(y)}`,
        `${String(x)},${String(y + 1)}`,
        `${String(x)},${String(y - 1)}`,
      ]) {
        if (rowKeys.has(neighbor) && !visited.has(neighbor)) queue.push(neighbor);
      }
    }
    expect(visited.size).toBe(rowKeys.size);
  });

  it('finds straight and turning two-cell connectors with deterministic ties', () => {
    const straight = findTwoCellConnector({
      startPairs: [{ first: { x: 0, y: 0 }, second: { x: 0, y: 1 } }],
      goalPairs: [{ first: { x: 3, y: 0 }, second: { x: 3, y: 1 } }],
      isActive: activeEverywhere,
      isCellAvailable: () => true,
      maxExpansions: 2_048,
    });
    expect(straight.status).toBe('found');
    expect(straight.turns).toBe(0);
    expect(straight.pairs).toEqual([
      { first: { x: 0, y: 0 }, second: { x: 0, y: 1 } },
      { first: { x: 1, y: 0 }, second: { x: 1, y: 1 } },
      { first: { x: 2, y: 0 }, second: { x: 2, y: 1 } },
      { first: { x: 3, y: 0 }, second: { x: 3, y: 1 } },
    ]);

    const turnInput = {
      startPairs: [{ first: { x: 0, y: 0 }, second: { x: 0, y: 1 } }],
      goalPairs: [{ first: { x: 2, y: 2 }, second: { x: 3, y: 2 } }],
      isActive: activeEverywhere,
      isCellAvailable: () => true,
      maxExpansions: 2_048,
    } as const;
    const turn = findTwoCellConnector(turnInput);
    expect(turn.status).toBe('found');
    expect(turn.turns).toBeGreaterThan(0);
    expect(findTwoCellConnector(turnInput)).toEqual(turn);
    const noConnector = findTwoCellConnector({
      startPairs: [{ first: { x: 0, y: 0 }, second: { x: 0, y: 1 } }],
      goalPairs: [{ first: { x: 5, y: 5 }, second: { x: 5, y: 4 } }],
      isActive: activeEverywhere,
      isCellAvailable: (position) =>
        (position.x === 0 && (position.y === 0 || position.y === 1)) ||
        (position.x === 5 && (position.y === 4 || position.y === 5)),
      maxExpansions: 2_048,
    });
    expect(noConnector.status).toBe('no-path');
  });

  it('keeps development work within fixed per-tick budgets and preserves ROW', () => {
    const simulation = createSimulation({
      chunkSize: 32,
      initialChunkRegion: { minX: 0, minY: 0, width: 8, height: 8 },
      startingData: 10,
      developmentEvaluationIntervalTicks: 1,
      citizenCount: 1,
    });
    const seed = simulation.placeDistrictSeed({ kind: 'living', position: { x: 6, y: 1 } });
    expect(seed.accepted).toBe(true);
    const beforeRow = new Set(
      simulation
        .getSnapshot()
        .rightOfWay.flatMap((chunk) => chunk.cells)
        .map((cell) => `${String(cell.x)},${String(cell.y)}`),
    );
    for (let tick = 0; tick < 80; tick += 1) {
      simulation.step();
      const snapshot = simulation.getSnapshot();
      expect(snapshot.developmentJob.anchorChecksThisTick).toBeLessThanOrEqual(512);
      expect(snapshot.developmentJob.preliminaryCandidatesRetained).toBeLessThanOrEqual(32);
      expect(snapshot.developmentJob.finalistsValidatedThisTick).toBeLessThanOrEqual(4);
      expect(snapshot.developmentJob.corridorExpansionsThisTick).toBeLessThanOrEqual(2_048);
    }
    const snapshot = simulation.getSnapshot();
    const afterRow = new Set(
      snapshot.rightOfWay
        .flatMap((chunk) => chunk.cells)
        .map((cell) => `${String(cell.x)},${String(cell.y)}`),
    );
    expect([...beforeRow].every((cell) => afterRow.has(cell))).toBe(true);
    expect(snapshot.structural.developmentPeakAnchorChecksPerTick).toBeLessThanOrEqual(512);
    expect(snapshot.structural.developmentPeakFinalistValidationsPerTick).toBeLessThanOrEqual(4);
    expect(snapshot.structural.developmentPeakCorridorExpansionsPerTick).toBeLessThanOrEqual(2_048);
    expect(snapshot.structural.developmentRoutePreservationChecks).toBe(0);
  });
});
