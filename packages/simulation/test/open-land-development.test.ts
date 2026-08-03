import { describe, expect, it } from 'vitest';
import { createChunkSpatialStore, createSimulation, findGridPathBetweenSets } from '../src';

function stepUntilProject(simulation: ReturnType<typeof createSimulation>, limit = 160): void {
  for (let index = 0; index < limit; index += 1) {
    if (simulation.getSnapshot().constructionProjects.length > 0) return;
    simulation.step();
  }
}

describe('open-land development reachability', () => {
  it('sanity checks open-land path reachability', () => {
    const store = createChunkSpatialStore(16);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) store.activate({ x, y });
    }
    const result = findGridPathBetweenSets(
      {
        chunkSize: 16,
        activeChunks: store.getActiveChunks(),
        isWalkable: (position) => store.isWalkable(position),
        maxNodes: 10_000,
      },
      [{ x: 63, y: 63 }],
      [{ x: 24, y: 23 }],
      'test',
    );
    expect(result.status).toBe('found');
  });

  it('starts a home project from an empty city after a Living seed', () => {
    const simulation = createSimulation({
      startingData: 10,
      developmentEvaluationIntervalTicks: 1,
    });
    expect(simulation.getSnapshot().buildings).toHaveLength(0);
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 50, y: 50 } }),
    ).toMatchObject({
      accepted: true,
      cost: 10,
    });
    stepUntilProject(simulation);
    expect(simulation.getSnapshot().constructionProjects).toHaveLength(1);
  });

  it('reaches distant open-land staging without a connector', () => {
    const simulation = createSimulation({
      startingData: 10,
      developmentEvaluationIntervalTicks: 1,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
    });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 100, y: 100 } }),
    ).toMatchObject({
      accepted: true,
    });
    stepUntilProject(simulation);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.constructionProjects).toHaveLength(1);
    expect(snapshot.constructionProjects[0]).not.toHaveProperty('connector');
    expect(snapshot.developmentCandidates.every((candidate) => !('connector' in candidate))).toBe(
      true,
    );
  });

  it('rejects unreachable staging deterministically without creating a project', () => {
    const left = createSimulation({
      startingData: 10,
      developmentEvaluationIntervalTicks: 1,
      pathSearchBudget: 1,
    });
    const right = createSimulation({
      startingData: 10,
      developmentEvaluationIntervalTicks: 1,
      pathSearchBudget: 1,
    });
    for (const simulation of [left, right]) {
      expect(
        simulation.placeDistrictSeed({ kind: 'living', position: { x: 100, y: 100 } }),
      ).toMatchObject({
        accepted: true,
      });
      stepUntilProject(simulation, 80);
    }
    expect(left.getSnapshot().constructionProjects).toHaveLength(0);
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
  });
});
