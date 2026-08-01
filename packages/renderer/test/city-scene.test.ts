import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { createSimulation } from '@idle-city/simulation';
import { describe, expect, it } from 'vitest';
import { createCityScene } from '../src/index';

describe('city scene', () => {
  it('creates snapshot entities and disposes without WebGL', () => {
    const engine = new NullEngine();
    const snapshot = createSimulation({ citizenCount: 3 }).getSnapshot();
    const city = createCityScene(engine, snapshot);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    expect(city.scene.getTransformNodeByName('building-home-1')).not.toBeNull();
    city.dispose();
    engine.dispose();
  });

  it('updates interpolation targets without mutating simulation state', () => {
    const engine = new NullEngine();
    const simulation = createSimulation({ citizenCount: 1, activityDurationTicks: 1 });
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    const snapshot = simulation.getSnapshot();
    const before = JSON.stringify(snapshot);
    const city = createCityScene(engine, snapshot);
    city.update(snapshot, 0.35);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    city.dispose();
    engine.dispose();
  });
});
