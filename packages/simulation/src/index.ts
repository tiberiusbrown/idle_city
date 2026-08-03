import {
  createCitizenId,
  createGridPosition,
  stableHash,
  type CitizenId,
  type GridPosition,
} from '@idle-city/shared';

export type { CitizenId, GridPosition } from '@idle-city/shared';

export interface SimulationOptions {
  readonly seed?: number;
}

export interface CitizenSnapshot {
  readonly id: CitizenId;
  readonly position: GridPosition;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly data: number;
  readonly population: number;
  readonly citizens: readonly CitizenSnapshot[];
  readonly zones: readonly never[];
  readonly buildings: readonly never[];
}

export interface Simulation {
  getSnapshot(): SimulationSnapshot;
  getDeterminismHash(): string;
}

interface CitizenState {
  readonly id: CitizenId;
  readonly position: GridPosition;
}

interface AuthoritativeState {
  readonly seed: number;
  readonly tick: number;
  readonly data: number;
  readonly citizens: readonly CitizenState[];
}

const INITIAL_CITIZEN_POSITIONS: readonly GridPosition[] = [
  createGridPosition(0, 0),
  createGridPosition(1, 0),
  createGridPosition(0, 1),
  createGridPosition(1, 1),
];

function validateSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`Simulation seeds must be safe integers; received ${String(seed)}.`);
  }
  return seed;
}

function createInitialState(seed: number): AuthoritativeState {
  const citizens = INITIAL_CITIZEN_POSITIONS.map((position, index) => ({
    id: createCitizenId(`citizen-${index + 1}`),
    position,
  }));

  return Object.freeze({
    seed: validateSeed(seed),
    tick: 0,
    data: 10,
    citizens: Object.freeze(citizens),
  });
}

function createSnapshot(state: AuthoritativeState): SimulationSnapshot {
  return {
    tick: state.tick,
    data: state.data,
    population: state.citizens.length,
    citizens: state.citizens.map((citizen) => ({
      id: citizen.id,
      position: { x: citizen.position.x, y: citizen.position.y },
    })),
    zones: [],
    buildings: [],
  };
}

export function createSimulation(options: SimulationOptions = {}): Simulation {
  const state = createInitialState(options.seed ?? 0);

  return {
    getSnapshot(): SimulationSnapshot {
      return createSnapshot(state);
    },
    getDeterminismHash(): string {
      return stableHash({
        seed: state.seed,
        tick: state.tick,
        data: state.data,
        citizens: state.citizens,
        zones: [],
        buildings: [],
      });
    },
  };
}
