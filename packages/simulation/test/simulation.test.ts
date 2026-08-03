import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/index';

describe('simulation skeleton', () => {
  it('starts at tick zero and keeps snapshot reads detached', () => {
    const simulation = createSimulation();
    const first = simulation.getSnapshot();
    const second = simulation.getSnapshot();

    expect(first).toEqual({ tick: 0 });
    expect(second).toEqual({ tick: 0 });
    expect(first).not.toBe(second);

    (first as { tick: number }).tick = 99;
    expect(simulation.getSnapshot()).toEqual({ tick: 0 });
  });
});
