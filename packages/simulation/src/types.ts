import type { GridPosition } from '@idle-city/shared';

export type BuildingType = 'home' | 'workplace';
export type CitizenActivity = 'home' | 'commuting-to-work' | 'work' | 'commuting-home';

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

export interface SimulationConfig {
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly citizenCount?: number;
  readonly activityDurationTicks?: number;
}

export interface SimulationSnapshot {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly tick: number;
  readonly randomState: number;
  readonly completedTrips: number;
  readonly buildings: readonly Building[];
  readonly citizens: readonly CitizenSnapshot[];
}

export interface Simulation {
  step(): void;
  getSnapshot(): SimulationSnapshot;
  getDeterminismHash(): string;
}
