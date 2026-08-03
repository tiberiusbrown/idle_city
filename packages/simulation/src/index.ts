import { stableHash } from '@idle-city/shared';

export interface SimulationSnapshot {
  readonly tick: 0;
}

export interface Simulation {
  getSnapshot(): SimulationSnapshot;
  getDeterminismHash(): string;
}

const initialSnapshot: SimulationSnapshot = Object.freeze({ tick: 0 });

export function createSimulation(): Simulation {
  return {
    getSnapshot(): SimulationSnapshot {
      return { tick: initialSnapshot.tick };
    },
    getDeterminismHash(): string {
      return stableHash(initialSnapshot);
    },
  };
}
