import type { ChunkCoordinate, GridPosition, GridRect } from '@idle-city/shared';

export type BuildingType = 'home' | 'workplace';
export type CitizenActivity = 'home' | 'commuting-to-work' | 'work' | 'commuting-home';
export type DemandKind = 'living' | 'working' | 'services';
export type DistrictSeedKind = 'living' | 'working' | 'services';
export type ConstructionPhase = 'survey' | 'blueprint' | 'foundation' | 'frame' | 'completion';

export type DevelopmentReasonCode =
  | 'matching-seed-influence'
  | 'local-matching-demand'
  | 'complementary-use'
  | 'access-improvement'
  | 'entrance-accessibility';

export interface DevelopmentReason {
  readonly code: DevelopmentReasonCode;
  readonly text: string;
  readonly scoreContribution: number;
}

export interface Building {
  readonly id: string;
  readonly type: BuildingType;
  readonly footprint: GridRect;
  readonly entrance: GridPosition;
  readonly capacity: number;
}

/** Detached authoritative occupancy for one completed building. */
export interface BuildingOccupancy {
  readonly buildingId: string;
  readonly buildingType: BuildingType;
  readonly occupied: number;
  /** Alias retained in the snapshot so consumers can use occupancy terminology directly. */
  readonly occupancy: number;
  readonly capacity: number;
  readonly available: number;
}

/**
 * A valid, ranked development option from the most recent fixed-cadence
 * evaluation. Candidates are derived data; only an accepted candidate becomes
 * an authoritative construction project.
 */
export interface DevelopmentCandidate {
  readonly buildingType: BuildingType;
  readonly anchor: GridPosition;
  readonly footprint: GridRect;
  readonly entrance: GridPosition;
  readonly entranceOrder: number;
  readonly score: number;
  readonly primaryReason: DevelopmentReason;
  readonly localMatchingDemand: number;
  readonly seedInfluence: number;
  readonly complementaryUse: number;
  readonly entranceAccessibility: number;
  readonly expectedAccessImprovement: number;
  readonly sameUseSaturation: number;
  readonly constructionCost: number;
  /** Weighted spatial/access summary: 0.6 entrance access + 0.4 planned access improvement. */
  readonly spatialFactor: number;
}

export interface ConstructionProject {
  readonly id: string;
  readonly buildingType: BuildingType;
  readonly footprint: GridRect;
  readonly entrance: GridPosition;
  readonly capacity: number;
  readonly phase: ConstructionPhase;
  readonly phaseTicksRemaining: number;
  readonly phaseTicksElapsed: number;
  readonly totalTicksElapsed: number;
  readonly startedTick: number;
  readonly score: number;
  readonly primaryReason: DevelopmentReason;
  readonly seedInfluence: number;
  readonly spatialFactor: number;
  readonly expectedAccessImprovement: number;
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
  /** Consecutive logical ticks for which this commuter's proposal was blocked. */
  readonly waitTicks: number;
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

export interface ValidDistrictSeedPlacementPreview {
  readonly valid: true;
  readonly cost: number;
}

export interface InvalidDistrictSeedPlacementPreview {
  readonly valid: false;
  readonly reason: CommandRejectionReason;
}

export type DistrictSeedPlacementPreview =
  ValidDistrictSeedPlacementPreview | InvalidDistrictSeedPlacementPreview;

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

export interface TrafficEdgeSnapshot {
  readonly key: string;
  readonly a: GridPosition;
  readonly b: GridPosition;
  readonly aToB: number;
  readonly bToA: number;
  readonly total: number;
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
  readonly developmentEvaluations: number;
  readonly developmentCandidatesScored: number;
  readonly developmentFootprintsRejected: number;
  readonly developmentEntrancesRejected: number;
  readonly constructionProjectsStarted: number;
  readonly constructionProjectsCompleted: number;
  readonly activeTrafficEdges: number;
  readonly trafficTraversalEventsRecorded: number;
  readonly trafficExpiredTraversalEvents: number;
  readonly trafficExpiredBuckets: number;
  readonly trafficPeakActiveEdges: number;
  readonly movementProposals: number;
  readonly movementCommittedMoves: number;
  readonly movementBlockedMoves: number;
  readonly movementTargetConflicts: number;
  readonly movementDependencyBlocks: number;
  readonly movementCyclesCommitted: number;
  readonly movementOrdinarySwapsRejected: number;
  readonly movementReplansAttempted: number;
  readonly movementReplansSucceeded: number;
  readonly movementDeadlockRecoveries: number;
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
  /** Number of citizens present when the simulation is created. Zero is valid. */
  readonly citizenCount?: number;
  /** Alias for citizenCount used by population-focused scenarios. */
  readonly initialPopulation?: number;
  readonly activityDurationTicks?: number;
  readonly housingCapacity?: number;
  readonly workplaceCapacity?: number;
  /** Maximum number of citizens that may exist at once. */
  readonly populationCap?: number;
  /** Alias for populationCap retained for headless scenario readability. */
  readonly maxPopulation?: number;
  /** Fixed logical ticks between population growth attempts. */
  readonly populationGrowthCadenceTicks?: number;
  /** Alias for populationGrowthCadenceTicks. */
  readonly populationGrowthIntervalTicks?: number;
  readonly startingData?: number;
  /** Logical ticks between deterministic developer evaluations. */
  readonly developmentEvaluationIntervalTicks?: number;
  /** Minimum rounded score required for a candidate to be eligible. */
  readonly developmentMinimumScore?: number;
  /** Maximum ranked candidates retained in ordinary detached snapshots. */
  readonly developmentCandidateSnapshotLimit?: number;
  readonly developmentHomeCapacity?: number;
  readonly developmentWorkplaceCapacity?: number;
  readonly constructionPhaseDurations?: Partial<Record<ConstructionPhase, number>>;
  /** Logical ticks retained by internal movement telemetry; defaults to exactly 256. */
  readonly trafficHistoryWindowTicks?: number;
  /** Alias for trafficHistoryWindowTicks used by focused telemetry scenarios. */
  readonly trafficWindowTicks?: number;
}

export interface SimulationSnapshot {
  readonly chunkSize: number;
  readonly activeChunkCount: number;
  readonly activeChunks: readonly ActiveChunkSnapshot[];
  readonly seed: number;
  readonly tick: number;
  readonly randomState: number;
  readonly trafficHistoryWindowTicks: number;
  readonly populationCap: number;
  readonly populationGrowthCadenceTicks: number;
  readonly completedTrips: number;
  readonly completedActivities: number;
  readonly data: number;
  readonly dataGeneratedThisTick: number;
  readonly averageTripDurationTicks: number;
  readonly metrics: CityMetrics;
  readonly demand: CityDemand;
  readonly traffic: readonly TrafficEdgeSnapshot[];
  readonly structural: SimulationStructuralCounters;
  readonly seeds: readonly DistrictSeed[];
  readonly buildings: readonly Building[];
  readonly occupancy: readonly BuildingOccupancy[];
  readonly citizens: readonly CitizenSnapshot[];
  readonly developmentCandidates: readonly DevelopmentCandidate[];
  readonly constructionProjects: readonly ConstructionProject[];
}

export interface Simulation {
  step(): void;
  previewDistrictSeed(command: PlaceDistrictSeedCommand): DistrictSeedPlacementPreview;
  placeDistrictSeed(command: PlaceDistrictSeedCommand): CommandResult;
  getCurrentDistrictSeedCost(kind: DistrictSeedKind): number;
  activateChunk(command: ActivateChunkCommand): ChunkActivationResult;
  getDemandChunk(chunk: ChunkCoordinate): DemandChunkSnapshot | undefined;
  queryDemandRegion(region: DemandRegionQuery): DemandRegionSnapshot;
  getSnapshot(): SimulationSnapshot;
  getDeterminismHash(): string;
}
