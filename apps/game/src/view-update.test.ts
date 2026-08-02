import type { SimulationSnapshot } from '@idle-city/simulation';
import { describe, expect, it } from 'vitest';
import { updateSimulationView } from './view-update';

describe('game view update', () => {
  it('passes one snapshot object to renderer and HUD callbacks', () => {
    const snapshot = {} as SimulationSnapshot;
    const seen: SimulationSnapshot[] = [];
    let interpolation = 0;

    updateSimulationView(
      snapshot,
      0.375,
      (received, receivedInterpolation) => {
        seen.push(received);
        interpolation = receivedInterpolation;
      },
      (received) => seen.push(received),
    );

    expect(seen).toEqual([snapshot, snapshot]);
    expect(seen[0]).toBe(seen[1]);
    expect(interpolation).toBe(0.375);
  });
});
