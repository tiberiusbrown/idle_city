import { createSimulation, type CityMetrics } from '@idle-city/simulation';

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
  readonly completedActivities: number;
  readonly data: number;
  readonly dataGeneratedThisTick: number;
  readonly averageTripDurationTicks: number;
  readonly metrics: CityMetrics;
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
    completedActivities: snapshot.completedActivities,
    data: snapshot.data,
    dataGeneratedThisTick: snapshot.dataGeneratedThisTick,
    averageTripDurationTicks: snapshot.averageTripDurationTicks,
    metrics: snapshot.metrics,
    determinismHash: simulation.getDeterminismHash(),
  };
}
