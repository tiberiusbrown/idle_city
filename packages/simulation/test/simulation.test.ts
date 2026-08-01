import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/index';

describe('simulation', () => {
  it('moves citizens at most one grid cell per tick', () => {
    const simulation = createSimulation({ seed: 22, citizenCount: 4 });
    for (let tick = 0; tick < 100; tick += 1) {
      const before = simulation.getSnapshot();
      simulation.step();
      const after = simulation.getSnapshot();
      after.citizens.forEach((citizen, index) => {
        const previous = before.citizens[index];
        if (previous === undefined) throw new Error('Citizen ordering changed between snapshots.');
        expect(
          Math.abs(citizen.position.x - previous.position.x) +
            Math.abs(citizen.position.y - previous.position.y),
        ).toBeLessThanOrEqual(1);
      });
    }
  });

  it('eventually completes a home-to-work trip', () => {
    const simulation = createSimulation({ citizenCount: 1 });
    for (let tick = 0; tick < 100 && simulation.getSnapshot().completedTrips === 0; tick += 1)
      simulation.step();
    const snapshot = simulation.getSnapshot();
    expect(snapshot.completedTrips).toBe(1);
    expect(snapshot.citizens[0]?.activity).toBe('work');
  });

  it('is reproducible and returns detached stable snapshots', () => {
    const left = createSimulation({ seed: 9876 });
    const right = createSimulation({ seed: 9876 });
    for (let tick = 0; tick < 250; tick += 1) {
      left.step();
      right.step();
    }
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
    const snapshot = left.getSnapshot();
    const firstCitizen = snapshot.citizens[0];
    if (firstCitizen === undefined) throw new Error('The default scenario requires citizens.');
    const originalX = firstCitizen.position.x;
    (firstCitizen.position as { x: number }).x = 999;
    expect(left.getSnapshot().citizens[0]?.position.x).toBe(originalX);
  });

  it('does not expose a rendering or frame-time input', () => {
    const simulation = createSimulation({ seed: 5 });
    expect(Object.keys(simulation).sort()).toEqual(['getDeterminismHash', 'getSnapshot', 'step']);
    for (let tick = 0; tick < 50; tick += 1) simulation.step();
    const expected = simulation.getDeterminismHash();
    const independentlyStepped = createSimulation({ seed: 5 });
    const fakeRenderFrames = [1, 4, 2, 7, 3, 9, 24];
    for (let tick = 0; tick < 50; tick += 1) {
      const frameCount = fakeRenderFrames[tick % fakeRenderFrames.length];
      if (frameCount === undefined) throw new Error('Frame pattern must not be empty.');
      for (let frame = 0; frame < frameCount; frame += 1) {
        independentlyStepped.getSnapshot();
      }
      independentlyStepped.step();
    }
    expect(independentlyStepped.getDeterminismHash()).toBe(expected);
  });
});
