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

  it('reports bounded indicators and generates deterministic Data for completed work', () => {
    const configuration = {
      seed: 1,
      width: 6,
      height: 5,
      citizenCount: 1,
      activityDurationTicks: 1,
    } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    const initial = left.getSnapshot();

    expect(initial.data).toBe(0);
    expect(initial.completedActivities).toBe(0);
    expect(initial.averageTripDurationTicks).toBe(1);
    expect(initial.metrics).toEqual({ space: 1, access: 8 / 9, activity: 0 });

    let generatedData = false;
    for (let tick = 0; tick < 20; tick += 1) {
      const before = left.getSnapshot();
      left.step();
      right.step();
      const after = left.getSnapshot();
      expect(after).toEqual(right.getSnapshot());
      expect(after.data).toBeGreaterThanOrEqual(before.data);
      expect(after.data - before.data).toBeCloseTo(after.dataGeneratedThisTick, 6);
      for (const value of Object.values(after.metrics)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      generatedData ||= after.dataGeneratedThisTick > 0;
    }

    expect(generatedData).toBe(true);
    expect(left.getSnapshot().completedActivities).toBeGreaterThan(0);
    expect(left.getSnapshot().data).toBeGreaterThan(0);
  });

  it('handles co-located homes and workplaces without invalid routes', () => {
    const simulation = createSimulation({
      width: 5,
      height: 5,
      citizenCount: 1,
      activityDurationTicks: 1,
    });
    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    expect(simulation.getSnapshot().completedTrips).toBeGreaterThan(0);
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
