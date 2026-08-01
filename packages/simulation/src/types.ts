import type { ChunkCoordinate, GridPosition, GridRect } from '@idle-city/shared';

export type BuildingType = 'home' | 'workplace';
export type CitizenActivity = 'home' | 'commuting-to-work' | 'work' | 'commuting-home';
export type DemandKind = 'living' | 'working' | 'services';
export type DistrictSeedKind = 'living' | 'working' | 'services';

export interface Building {
  readonly id: string;
  readonly type: BuildingType;
  readonly footprint: GridRect;
  readonly entrance: GridPosition;
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

export interface DistrictSeed {
  readonly id: string;
  readonly kind: DistrictSeedKind;
  readonly position: GridPosition;
}

export interface PlaceDistrictSeedCommand {
  readonly kind: DistrictSeedKind;
  readonly position: GridPosition;
}

export type CommandRejectionReason =
  'invalid-kind' | 'out-of-bounds' | 'inactive-chunk' | 'occupied' | 'locked' | 'insufficient-data';

export interface AcceptedCommandResult {
  readonly accepted: true;
  readonly seed: DistrictSeed;
  readonly cost: number;
}

export interface RejectedCommandResult {
  readonly accepted: false;
  readonly reason: CommandRejectionReason;
}

export type CommandResult = AcceptedCommandResult | RejectedCommandResult;

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
  readonly totals: DemandTotals;
  readonly chunks: readonly DemandChunkSummary[];
}

export interface DemandChunkSummary {
  readonly chunk: ChunkCoordinate;
  readonly key: string;
  readonly revision: number;
  readonly cellCount: number;
  readonly totals: DemandTotals;
}

export interface DemandChunkSnapshot extends DemandChunkSummary {
  readonly cells: readonly DemandCell[];
}

export type DemandRegionQuery = GridRect;

export interface DemandRegionSnapshot {
  readonly rect: GridRect;
  readonly cells: readonly DemandCell[];
  readonly inactiveCellCount: number;
}

export interface ChunkRegion {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export interface ActiveChunkSnapshot {
  readonly chunk: ChunkCoordinate;
  readonly key: string;
  readonly occupancyRevision: number;
  readonly demandRevision: number;
  readonly occupancyBufferAllocated: boolean;
}

export interface SimulationStructuralCounters {
  readonly activeChunks: number;
  readonly allocatedChunks: number;
  readonly allocatedOccupancyBuffers: number;
  readonly allocatedDemandBuffers: number;
  readonly demandChunksDirtied: number;
  readonly demandChunksEvaluated: number;
  readonly pathNodesExpanded: number;
  readonly pathChunksTouched: number;
  readonly snapshotChunkSummaries: number;
}

export type ActivateChunkCommand = ChunkCoordinate;

export interface AcceptedChunkActivationResult {
  readonly accepted: true;
  readonly chunk: ChunkCoordinate;
  readonly activeChunkCount: number;
}

export type ChunkActivationRejectionReason =
  'invalid-chunk' | 'already-active' | 'not-adjacent' | 'active-chunk-limit';

export interface RejectedChunkActivationResult {
  readonly accepted: false;
  readonly reason: ChunkActivationRejectionReason;
}

export type ChunkActivationResult = AcceptedChunkActivationResult | RejectedChunkActivationResult;

export interface LegacyCityDemand {
  readonly cells: readonly DemandCell[];
  readonly totals: DemandTotals;
}

export interface SimulationConfig {
  readonly chunkSize?: number;
  readonly initialChunkRegion?: ChunkRegion;
  readonly initialActiveRegion?: ChunkRegion;
  readonly activeChunkLimit?: number;
  readonly demandQueryMaxCells?: number;
  readonly demandInfluenceRadius?: number;
  readonly pathSearchBudget?: number;
  readonly homePosition?: GridPosition;
  readonly workplacePosition?: GridPosition;
  /** Deprecated scenario-span aliases retained for headless balance fixtures. */
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly citizenCount?: number;
  readonly activityDurationTicks?: number;
  readonly housingCapacity?: number;
  readonly workplaceCapacity?: number;
  readonly startingData?: number;
}

export interface SimulationSnapshot {
  readonly chunkSize: number;
  readonly activeChunkCount: number;
  readonly activeChunks: readonly ActiveChunkSnapshot[];
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
  readonly structural: SimulationStructuralCounters;
  readonly seeds: readonly DistrictSeed[];
  readonly buildings: readonly Building[];
  readonly citizens: readonly CitizenSnapshot[];
}

export interface Simulation {
  step(): void;
  placeDistrictSeed(command: PlaceDistrictSeedCommand): CommandResult;
  activateChunk(command: ActivateChunkCommand): ChunkActivationResult;
  getDemandChunk(chunk: ChunkCoordinate): DemandChunkSnapshot | undefined;
  queryDemandRegion(region: DemandRegionQuery): DemandRegionSnapshot;
  getSnapshot(): SimulationSnapshot;
  getDeterminismHash(): string;
}
