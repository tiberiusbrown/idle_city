import type { GridPosition } from '@idle-city/shared';

export type BuildingType = 'home' | 'workplace';
export type CitizenActivity = 'home' | 'commuting-to-work' | 'work' | 'commuting-home';
export type DemandKind = 'living' | 'working' | 'services';

export interface Building {
  readonly id: string;
  readonly position: GridPosition;
  readonly type: BuildingType;
  readonly capacity: number;
}

export interface CitizenSnapshot {
  readonly id: string;
  readonly position: GridPosition;
  readonly previousPosition: GridPosition;
  readonly homeBuildingId: string;
  readonly workplaceBuildingId: string;
  readonly activity: CitizenActivity;
  readonly activityTicksRemaining: number;
  readonly route: readonly GridPosition[];
  readonly routeIndex: number;
}

/**
 * Normalized city indicators. A value of 1 is healthy and 0 is the worst
 * state represented by the current simulation slice.
 */
export interface CityMetrics {
  readonly space: number;
  readonly access: number;
  readonly activity: number;
}

export interface DemandCell {
  readonly position: GridPosition;
  readonly living: number;
  readonly working: number;
  readonly services: number;
}

export interface DemandTotals {
  readonly living: number;
  readonly working: number;
  readonly services: number;
}

export interface CityDemand {
  readonly cells: readonly DemandCell[];
  readonly totals: DemandTotals;
}

export interface SimulationConfig {
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly citizenCount?: number;
  readonly activityDurationTicks?: number;
  readonly housingCapacity?: number;
  readonly workplaceCapacity?: number;
}

export interface SimulationSnapshot {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly tick: number;
  readonly randomState: number;
  readonly completedTrips: number;
  readonly completedActivities: number;
  readonly data: number;
  readonly dataGeneratedThisTick: number;
  readonly averageTripDurationTicks: number;
  readonly metrics: CityMetrics;
  readonly demand: CityDemand;
  readonly buildings: readonly Building[];
  readonly citizens: readonly CitizenSnapshot[];
}

export interface Simulation {
  step(): void;
  getSnapshot(): SimulationSnapshot;
  getDeterminismHash(): string;
}
