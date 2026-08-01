export {
  findGridPath,
  findGridPathDetailed,
  pathChunks,
  type PathGrid,
  type PathSearchOptions,
  type PathSearchResult,
  type PathSearchStatus,
} from './pathfinding';
export {
  adjacentChunks,
  chunkCoordinateForPosition,
  chunkKey,
  chunkOrigin,
  compareChunks,
  DEFAULT_CHUNK_SIZE,
  enumerateChunkRegion,
  localCoordinateForPosition,
  validateChunkSize,
  ChunkSpatialStore,
  createChunkSpatialStore,
} from './chunks';
export {
  BUILDING_FOOTPRINTS,
  buildingFootprint,
  exteriorEntranceCandidates,
  footprintCells,
  isExteriorEntrance,
  isInsideFootprint,
  selectExteriorEntrance,
  type EntranceSelectionOptions,
} from './footprints';
export { SeededRandom } from './random';
export { calculateCityDemand, calculateDemandChunk } from './demand';
export {
  DISTRICT_SEED_COSTS,
  getDistrictSeedCost,
  isDistrictSeedKindUnlocked,
} from './balance-rules';
export { calculateDistrictSeedInfluence, type DistrictSeedInfluenceInput } from './district-seeds';
export { createSimulation } from './simulation';
export type { ChunkCoordinate, GridPosition, GridRect } from '@idle-city/shared';
export type {
  AcceptedCommandResult,
  Building,
  BuildingType,
  ChunkActivationRejectionReason,
  ChunkActivationResult,
  ChunkRegion,
  ActivateChunkCommand,
  ActiveChunkSnapshot,
  CitizenActivity,
  CitizenSnapshot,
  CityDemand,
  CityMetrics,
  CommandRejectionReason,
  CommandResult,
  DemandCell,
  DemandChunkSnapshot,
  DemandChunkSummary,
  DemandKind,
  DemandRegionQuery,
  DemandRegionSnapshot,
  DemandTotals,
  DistrictSeed,
  DistrictSeedKind,
  LegacyCityDemand,
  PlaceDistrictSeedCommand,
  RejectedCommandResult,
  Simulation,
  SimulationConfig,
  SimulationSnapshot,
  SimulationStructuralCounters,
} from './types';
export type {
  DemandCalculationInput,
  DemandChunkCalculationInput,
  DemandCitizen,
  DemandSeedInfluence,
} from './demand';
