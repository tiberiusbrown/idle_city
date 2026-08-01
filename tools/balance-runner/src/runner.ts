import { createSimulation } from '@idle-city/simulation';

export interface BalanceOptions {
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount?: number;
}

export interface BalanceSummary {
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount: number;
  readonly completedTrips: number;
  readonly determinismHash: string;
}

export function runBalance(options: BalanceOptions): BalanceSummary {
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 0)
    throw new Error('ticks must be a non-negative safe integer.');
  const simulation = createSimulation({
    seed: options.seed,
    citizenCount: options.citizenCount ?? 10,
  });
  for (let tick = 0; tick < options.ticks; tick += 1) simulation.step();
  const snapshot = simulation.getSnapshot();
  return {
    seed: options.seed,
    ticks: options.ticks,
    citizenCount: snapshot.citizens.length,
    completedTrips: snapshot.completedTrips,
    determinismHash: simulation.getDeterminismHash(),
  };
}
