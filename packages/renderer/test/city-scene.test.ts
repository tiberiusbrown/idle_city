import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { createSimulation } from '@idle-city/simulation';
import { describe, expect, it } from 'vitest';
import { createCityScene, logicalToWorld } from '../src/index';

describe('visible chunk city scene', () => {
  it('renders only selected chunks with bounded mesh counts and disposes without WebGL', () => {
    const engine = new NullEngine();
    const snapshot = createSimulation({ citizenCount: 3 }).getSnapshot();
    const city = createCityScene(engine, snapshot, {
      visibleChunks: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    const counters = city.getStructuralCounters();
    expect(counters.visibleChunks).toBe(2);
    expect(counters.renderedChunks).toBe(2);
    expect(counters.chunkRebuilds).toBe(2);
    expect(counters.meshCount).toBeLessThan(
      2 + snapshot.buildings.length * 2 + snapshot.citizens.length * 2 + 2,
    );
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    expect(city.scene.getTransformNodeByName('building-home-1')).not.toBeNull();
    city.dispose();
    engine.dispose();
  });

  it('rebuilds ground only when a visible chunk revision changes', () => {
    const engine = new NullEngine();
    const snapshot = createSimulation({ citizenCount: 1 }).getSnapshot();
    const city = createCityScene(engine, snapshot, { visibleChunks: [{ x: 0, y: 0 }] });
    const initialCounters = city.getStructuralCounters();
    city.update(snapshot, 0.5);
    expect(city.getStructuralCounters().chunkRebuilds).toBe(initialCounters.chunkRebuilds);

    const changed = {
      ...snapshot,
      activeChunks: snapshot.activeChunks.map((chunk) =>
        chunk.key === '0:0' ? { ...chunk, occupancyRevision: chunk.occupancyRevision + 1 } : chunk,
      ),
    };
    city.update(changed, 0.5);
    expect(city.getStructuralCounters().chunkRebuilds).toBe(initialCounters.chunkRebuilds + 1);
    city.dispose();
    engine.dispose();
  });

  it('updates interpolation across signed coordinates without mutating snapshots', () => {
    const engine = new NullEngine();
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: -1, minY: -1, width: 3, height: 3 },
      homePosition: { x: -6, y: -6 },
      workplacePosition: { x: 10, y: 10 },
      citizenCount: 1,
      activityDurationTicks: 1,
    });
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    const snapshot = simulation.getSnapshot();
    const before = JSON.stringify(snapshot);
    const city = createCityScene(engine, snapshot, { visibleChunks: [{ x: -1, y: -1 }] });
    city.update(snapshot, 0.35);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(logicalToWorld({ x: -1, y: -1 }).x).toBeCloseTo(-0.125);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    city.dispose();
    engine.dispose();
  });
});
