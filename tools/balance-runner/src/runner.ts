import {
  CONSTRUCTION_PHASE_ORDER,
  chunkCoordinateForPosition,
  chunkKey,
  canonicalTrafficEdge,
  circulationEnvelopeCells,
  compareChunks,
  createSimulation,
  DISTRICT_SEED_COSTS,
  footprintCells,
  isExteriorEntrance,
  type ActivateChunkCommand,
  type CityMetrics,
  type ChunkActivationResult,
  type CommandResult,
  type DemandTotals,
  type DistrictSeed,
  type DistrictSeedPlacementInfo,
  type PlaceDistrictSeedCommand,
  type SimulationConfig,
  type SimulationSnapshot,
  type SimulationStructuralCounters,
  type TrafficEdgeSnapshot,
} from '@idle-city/simulation';

export const balanceScenarioNames = [
  'baseline',
  'long-commute',
  'capacity-pressure',
  'compact',
  'living-seed',
  'working-seed',
  'rejected-command',
  'sparse-expansion',
  'extent',
  'localized-demand',
  'long-route',
  'one-commuter',
  'two-opposite-direction-commuters',
  'shared-corridor',
  'narrow-passage',
  'multi-chunk-commute',
  'long-running-repeated-commute',
  'crossing-flows',
  'narrow-shared-corridor',
  'entrance-bottleneck',
  'two-way-corridor',
  'dense-commute',
  'multi-chunk-merge',
  'living-led',
  'working-led',
  'equal-score',
  'obstacle-constrained',
  'no-valid-footprint',
  'long-run-construction',
  'housing-surplus',
  'workplace-surplus',
  'balanced-expansion',
  'tie',
  'capped-growth',
  'long-run-city',
  'seed-boundary',
  'multiple-same-type-seeds',
  'sparse-development',
  'two-connected-row-buildings',
  'narrow-connector',
  'dense-circulation',
  'development-supersession',
  'long-incremental-development',
  'step9-dense-movement',
  'one-worker-slow-build',
  'full-staff-build',
  'workers-competing-one-corridor',
  'staging-cell-queue',
  'worker-blocked-replans',
  'no-eligible-workers',
  'phase-cap-decrease',
  'construction-dense-commute',
  'off-screen-construction',
  'repeated-deterministic-construction',
] as const;

export type BalanceScenarioName = (typeof balanceScenarioNames)[number];

export interface ScheduledDistrictSeedCommand {
  /** The simulation tick at which this command is applied; tick 0 is pre-step. */
  readonly tick: number;
  readonly command: PlaceDistrictSeedCommand;
}

export interface ScheduledChunkActivationCommand {
  /** The simulation tick at which this activation is applied; tick 0 is pre-step. */
  readonly tick: number;
  readonly command: ActivateChunkCommand;
}

interface BalanceScenarioDefinition {
  readonly config: SimulationConfig;
  readonly commands: readonly ScheduledDistrictSeedCommand[];
  readonly activations: readonly ScheduledChunkActivationCommand[];
}

function linearActivations(
  count: number,
  axis: 'x' | 'y' = 'x',
): readonly ScheduledChunkActivationCommand[] {
  return Array.from({ length: count }, (_, index) => ({
    tick: index,
    command: axis === 'x' ? { x: index + 1, y: 0 } : { x: 0, y: index + 1 },
  }));
}

function trafficScenarioConfig(overrides: SimulationConfig): SimulationConfig {
  return {
    activityDurationTicks: 1,
    populationGrowthCadenceTicks: 1_000_000,
    developmentEvaluationIntervalTicks: 1_000_000,
    ...overrides,
  };
}

const scenarioDefinitions: Record<BalanceScenarioName, BalanceScenarioDefinition> = {
  baseline: { config: {}, commands: [], activations: [] },
  'long-commute': {
    config: {
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 6, height: 6 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 70, y: 70 },
    },
    commands: [],
    activations: [],
  },
  'capacity-pressure': {
    config: {
      housingCapacity: 4,
      workplaceCapacity: 4,
      developmentEvaluationIntervalTicks: 100,
    },
    commands: [],
    activations: [],
  },
  compact: {
    config: {
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 10, y: 10 },
    },
    commands: [],
    activations: [],
  },
  'living-seed': {
    config: {
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 100,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } },
      { tick: 1, command: { kind: 'working', position: { x: 5, y: 1 } } },
    ],
    activations: [],
  },
  'working-seed': {
    config: {
      startingData: DISTRICT_SEED_COSTS.working,
      developmentEvaluationIntervalTicks: 100,
    },
    commands: [
      { tick: 0, command: { kind: 'working', position: { x: 8, y: 6 } } },
      { tick: 1, command: { kind: 'services', position: { x: 3, y: 3 } } },
    ],
    activations: [],
  },
  'rejected-command': {
    config: {},
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: -1, y: 0 } } },
      { tick: 1, command: { kind: 'services', position: { x: 3, y: 3 } } },
      { tick: 2, command: { kind: 'working', position: { x: 4, y: 4 } } },
    ],
    activations: [],
  },
  'sparse-expansion': {
    config: {
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 1, height: 1 },
      activeChunkLimit: 32,
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 10, y: 10 },
    },
    commands: [],
    activations: linearActivations(6),
  },
  extent: {
    config: {
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 1, height: 1 },
      activeChunkLimit: 128,
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 10, y: 10 },
    },
    commands: [],
    activations: linearActivations(70),
  },
  'localized-demand': {
    config: { startingData: DISTRICT_SEED_COSTS.living },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'long-route': {
    config: {
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 8, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 100, y: 8 },
      pathSearchBudget: 50_000,
    },
    commands: [],
    activations: [],
  },
  'one-commuter': {
    config: trafficScenarioConfig({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 18, y: 10 },
      citizenCount: 1,
      housingCapacity: 1,
      workplaceCapacity: 1,
      populationCap: 1,
    }),
    commands: [],
    activations: [],
  },
  'two-opposite-direction-commuters': {
    config: trafficScenarioConfig({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 18, y: 10 },
      citizenCount: 2,
      housingCapacity: 2,
      workplaceCapacity: 2,
      populationCap: 2,
    }),
    commands: [],
    activations: [],
  },
  'shared-corridor': {
    config: trafficScenarioConfig({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 18, y: 10 },
      citizenCount: 6,
      housingCapacity: 6,
      workplaceCapacity: 6,
      populationCap: 6,
    }),
    commands: [],
    activations: [],
  },
  'narrow-passage': {
    config: trafficScenarioConfig({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 1 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 0 },
      citizenCount: 1,
      housingCapacity: 1,
      workplaceCapacity: 1,
      populationCap: 1,
    }),
    commands: [],
    activations: [],
  },
  'multi-chunk-commute': {
    config: trafficScenarioConfig({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 24, y: 24 },
      citizenCount: 1,
      housingCapacity: 1,
      workplaceCapacity: 1,
      populationCap: 1,
      pathSearchBudget: 50_000,
    }),
    commands: [],
    activations: [],
  },
  'long-running-repeated-commute': {
    config: trafficScenarioConfig({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 18, y: 10 },
      citizenCount: 4,
      housingCapacity: 4,
      workplaceCapacity: 4,
      populationCap: 4,
    }),
    commands: [],
    activations: [],
  },
  'crossing-flows': {
    config: trafficScenarioConfig({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 3, height: 3 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 34, y: 10 },
      citizenCount: 8,
      housingCapacity: 8,
      workplaceCapacity: 8,
      populationCap: 8,
    }),
    commands: [],
    activations: [],
  },
  'narrow-shared-corridor': {
    config: trafficScenarioConfig({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 1 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 0 },
      citizenCount: 6,
      housingCapacity: 6,
      workplaceCapacity: 6,
      populationCap: 6,
    }),
    commands: [],
    activations: [],
  },
  'entrance-bottleneck': {
    config: trafficScenarioConfig({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 18, y: 10 },
      citizenCount: 12,
      housingCapacity: 12,
      workplaceCapacity: 12,
      populationCap: 12,
    }),
    commands: [],
    activations: [],
  },
  'two-way-corridor': {
    config: trafficScenarioConfig({
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 18, y: 10 },
      citizenCount: 10,
      housingCapacity: 10,
      workplaceCapacity: 10,
      populationCap: 10,
    }),
    commands: [],
    activations: [],
  },
  'dense-commute': {
    config: trafficScenarioConfig({
      chunkSize: 8,
      initialChunkRegion: { minX: -1, minY: -1, width: 4, height: 4 },
      homePosition: { x: -6, y: -6 },
      workplacePosition: { x: 18, y: 18 },
      citizenCount: 20,
      housingCapacity: 20,
      workplaceCapacity: 20,
      populationCap: 20,
    }),
    commands: [],
    activations: [],
  },
  'multi-chunk-merge': {
    config: trafficScenarioConfig({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 24, y: 24 },
      citizenCount: 8,
      housingCapacity: 8,
      workplaceCapacity: 8,
      populationCap: 8,
      pathSearchBudget: 50_000,
    }),
    commands: [],
    activations: [],
  },
  'living-led': {
    config: {
      startingData: DISTRICT_SEED_COSTS.living,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'working-led': {
    config: {
      startingData: DISTRICT_SEED_COSTS.working,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [{ tick: 0, command: { kind: 'working', position: { x: 8, y: 6 } } }],
    activations: [],
  },
  'equal-score': {
    config: {
      startingData: DISTRICT_SEED_COSTS.living + DISTRICT_SEED_COSTS.working,
      developmentEvaluationIntervalTicks: 100,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } },
      { tick: 0, command: { kind: 'working', position: { x: 8, y: 6 } } },
    ],
    activations: [],
  },
  'obstacle-constrained': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 100,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'no-valid-footprint': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 1, height: 1 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 3, y: 3 },
      startingData: DISTRICT_SEED_COSTS.living,
      developmentMinimumScore: 1,
      developmentEvaluationIntervalTicks: 100,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 1, y: 6 } } }],
    activations: [],
  },
  'long-run-construction': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      startingData: DISTRICT_SEED_COSTS.living + DISTRICT_SEED_COSTS.working,
      developmentEvaluationIntervalTicks: 10,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } },
      { tick: 1, command: { kind: 'working', position: { x: 6, y: 1 } } },
    ],
    activations: [],
  },
  'housing-surplus': {
    config: {
      citizenCount: 1,
      housingCapacity: 6,
      workplaceCapacity: 1,
      populationCap: 6,
      populationGrowthCadenceTicks: 5,
    },
    commands: [],
    activations: [],
  },
  'workplace-surplus': {
    config: {
      citizenCount: 1,
      housingCapacity: 1,
      workplaceCapacity: 6,
      populationCap: 6,
      populationGrowthCadenceTicks: 5,
    },
    commands: [],
    activations: [],
  },
  'balanced-expansion': {
    config: {
      citizenCount: 1,
      housingCapacity: 6,
      workplaceCapacity: 6,
      populationCap: 6,
      populationGrowthCadenceTicks: 5,
    },
    commands: [],
    activations: [],
  },
  tie: {
    config: {
      citizenCount: 0,
      housingCapacity: 4,
      workplaceCapacity: 4,
      populationCap: 4,
      populationGrowthCadenceTicks: 1,
      homePosition: { x: 2, y: 2 },
      workplacePosition: { x: 10, y: 2 },
    },
    commands: [],
    activations: [],
  },
  'capped-growth': {
    config: {
      citizenCount: 1,
      housingCapacity: 8,
      workplaceCapacity: 8,
      populationCap: 3,
      populationGrowthCadenceTicks: 5,
    },
    commands: [],
    activations: [],
  },
  'long-run-city': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 1,
      housingCapacity: 4,
      workplaceCapacity: 20,
      populationCap: 20,
      populationGrowthCadenceTicks: 5,
      startingData: DISTRICT_SEED_COSTS.living + DISTRICT_SEED_COSTS.working,
      developmentEvaluationIntervalTicks: 10,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } },
      { tick: 1, command: { kind: 'working', position: { x: 6, y: 1 } } },
    ],
    activations: [],
  },
  'seed-boundary': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 1_000_000,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 7, y: 1 } } }],
    activations: [],
  },
  'multiple-same-type-seeds': {
    config: {
      startingData: 30,
      developmentEvaluationIntervalTicks: 1_000_000,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 6, y: 1 } } },
      { tick: 0, command: { kind: 'living', position: { x: 14, y: 1 } } },
    ],
    activations: [],
  },
  'sparse-development': {
    config: {
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 8, height: 8 },
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'two-connected-row-buildings': {
    config: {
      chunkSize: 16,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      startingData: DISTRICT_SEED_COSTS.living + DISTRICT_SEED_COSTS.working,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } },
      { tick: 1, command: { kind: 'working', position: { x: 25, y: 1 } } },
    ],
    activations: [],
  },
  'narrow-connector': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 1 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 0 },
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 1,
      developmentCorridorExpansionBudget: 1,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 6, y: 1 } } }],
    activations: [],
  },
  'dense-circulation': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      startingData: 40,
      citizenCount: 20,
      housingCapacity: 20,
      workplaceCapacity: 20,
      populationCap: 20,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 6, y: 1 } } }],
    activations: [],
  },
  'development-supersession': {
    config: {
      chunkSize: 32,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      startingData: 30,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 6, y: 1 } } },
      { tick: 1, command: { kind: 'working', position: { x: 22, y: 1 } } },
    ],
    activations: [],
  },
  'long-incremental-development': {
    config: {
      chunkSize: 32,
      initialChunkRegion: { minX: 0, minY: 0, width: 8, height: 8 },
      startingData: DISTRICT_SEED_COSTS.living,
      developmentEvaluationIntervalTicks: 1,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 6, y: 1 } } }],
    activations: [],
  },
  'step9-dense-movement': {
    config: trafficScenarioConfig({
      chunkSize: 8,
      initialChunkRegion: { minX: -1, minY: -1, width: 4, height: 4 },
      homePosition: { x: -6, y: -6 },
      workplacePosition: { x: 18, y: 18 },
      citizenCount: 20,
      housingCapacity: 20,
      workplaceCapacity: 20,
      populationCap: 20,
    }),
    commands: [],
    activations: [],
  },
  'one-worker-slow-build': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 1,
      housingCapacity: 1,
      workplaceCapacity: 1,
      populationCap: 1,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'full-staff-build': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 3,
      housingCapacity: 3,
      workplaceCapacity: 3,
      populationCap: 3,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'workers-competing-one-corridor': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 0 },
      citizenCount: 6,
      housingCapacity: 6,
      workplaceCapacity: 6,
      populationCap: 6,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 6, y: 1 } } }],
    activations: [],
  },
  'staging-cell-queue': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 6,
      housingCapacity: 6,
      workplaceCapacity: 6,
      populationCap: 6,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'worker-blocked-replans': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 20,
      housingCapacity: 20,
      workplaceCapacity: 20,
      populationCap: 20,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'no-eligible-workers': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 0,
      housingCapacity: 0,
      workplaceCapacity: 0,
      populationCap: 0,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'phase-cap-decrease': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 3,
      housingCapacity: 3,
      workplaceCapacity: 3,
      populationCap: 3,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
      constructionPhaseDurations: { frame: 100 },
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
  'construction-dense-commute': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: -1, minY: -1, width: 4, height: 4 },
      homePosition: { x: -6, y: -6 },
      workplacePosition: { x: 18, y: 18 },
      citizenCount: 20,
      housingCapacity: 20,
      workplaceCapacity: 20,
      populationCap: 20,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: -1, y: -5 } } }],
    activations: [],
  },
  'off-screen-construction': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 24, y: 24 },
      citizenCount: 1,
      housingCapacity: 1,
      workplaceCapacity: 1,
      populationCap: 1,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 20, y: 1 } } }],
    activations: [],
  },
  'repeated-deterministic-construction': {
    config: {
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 3,
      housingCapacity: 3,
      workplaceCapacity: 3,
      populationCap: 3,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: DISTRICT_SEED_COSTS.living,
    },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 5, y: 1 } } }],
    activations: [],
  },
};

export function isBalanceScenarioName(value: string): value is BalanceScenarioName {
  return balanceScenarioNames.includes(value as BalanceScenarioName);
}

export function getBalanceScenarioConfig(scenario: BalanceScenarioName): SimulationConfig {
  return { ...scenarioDefinitions[scenario].config };
}

export function getBalanceScenarioCommands(
  scenario: BalanceScenarioName,
): readonly ScheduledDistrictSeedCommand[] {
  return scenarioDefinitions[scenario].commands.map(({ tick, command }) => ({
    tick,
    command: { ...command, position: { ...command.position } },
  }));
}

export function getBalanceScenarioActivations(
  scenario: BalanceScenarioName,
): readonly ScheduledChunkActivationCommand[] {
  return scenarioDefinitions[scenario].activations.map(({ tick, command }) => ({
    tick,
    command: { ...command },
  }));
}

export interface BalanceOptions {
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount?: number;
  readonly initialPopulation?: number;
  readonly populationCap?: number;
  readonly populationGrowthCadenceTicks?: number;
  readonly scenario?: BalanceScenarioName;
  readonly commands?: readonly ScheduledDistrictSeedCommand[];
  readonly activations?: readonly ScheduledChunkActivationCommand[];
}

export interface BalanceCommandResult {
  readonly tick: number;
  readonly command: PlaceDistrictSeedCommand;
  readonly preview: DistrictSeedPlacementInfo;
  readonly result: CommandResult;
}

export interface BalanceActivationResult {
  readonly tick: number;
  readonly command: ActivateChunkCommand;
  readonly result: ChunkActivationResult;
}

export interface BalanceMovementSummary {
  readonly proposals: number;
  readonly committedMoves: number;
  readonly blockedMoves: number;
  readonly averageWaitTicks: number;
  readonly maxWaitTicks: number;
  readonly targetConflicts: number;
  readonly dependencyBlocks: number;
  readonly cyclesCommitted: number;
  readonly ordinarySwapsRejected: number;
  readonly replansAttempted: number;
  readonly replansSucceeded: number;
  readonly emergencySwaps: number;
}

export interface BalanceConstructionSummary {
  readonly assignmentsOffered: number;
  readonly assignmentsAccepted: number;
  readonly constructionCommutes: number;
  readonly workerArrivals: number;
  readonly laborUnits: number;
  readonly pausedProjectTicks: number;
  readonly phaseCompletions: number;
  readonly workerReleases: number;
}

export interface BalanceSummary {
  readonly scenario: BalanceScenarioName;
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount: number;
  readonly populationCap: number;
  readonly populationGrowthCadenceTicks: number;
  readonly completedTrips: number;
  readonly completedActivities: number;
  readonly data: number;
  readonly dataGeneratedThisTick: number;
  readonly averageTripDurationTicks: number;
  readonly metrics: CityMetrics;
  readonly demandTotals: DemandTotals;
  readonly seeds: readonly DistrictSeed[];
  readonly activeChunkCount: number;
  readonly movement: BalanceMovementSummary;
  readonly construction: BalanceConstructionSummary;
  readonly traffic: readonly TrafficEdgeSnapshot[];
  readonly activeTrafficEdges: number;
  /** Current-window sum of all per-edge directional counters. */
  readonly directionalTraversals: number;
  /** Current-window sum of all per-edge total counters. */
  readonly totalTraversals: number;
  readonly trafficTraversalEventsRecorded: number;
  readonly expiredTraversalEvents: number;
  readonly peakActiveEdges: number;
  readonly structuralCounters: SimulationStructuralCounters;
  readonly snapshotChunkSummaries: number;
  readonly snapshotTrafficSummaries: number;
  readonly commandResults: readonly BalanceCommandResult[];
  readonly activationResults: readonly BalanceActivationResult[];
  readonly buildingCount: number;
  readonly homeCount: number;
  readonly workplaceCount: number;
  readonly activeConstructionProjects: number;
  readonly constructionProjectsStarted: number;
  readonly constructionProjectsCompleted: number;
  readonly developmentEvaluations: number;
  readonly developmentJob: SimulationSnapshot['developmentJob'];
  readonly invariantFailures: readonly string[];
  readonly determinismHash: string;
}

function active(
  snapshot: SimulationSnapshot,
  position: { readonly x: number; readonly y: number },
): boolean {
  const coordinate = chunkCoordinateForPosition(position, snapshot.chunkSize);
  return snapshot.activeChunks.some((chunk) => chunk.key === chunkKey(coordinate));
}

function adjacent(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectInvariantFailures(snapshot: SimulationSnapshot): readonly string[] {
  const failures: string[] = [];
  const fail = (message: string): void => {
    failures.push(message);
  };
  const activeKeys = new Set<string>();
  let previousChunk: { readonly x: number; readonly y: number } | undefined;
  for (const chunk of snapshot.activeChunks) {
    if (activeKeys.has(chunk.key)) fail(`duplicate active chunk ${chunk.key}`);
    activeKeys.add(chunk.key);
    if (chunk.key !== chunkKey(chunk.chunk)) fail(`active chunk key mismatch ${chunk.key}`);
    if (previousChunk !== undefined && compareChunks(chunk.chunk, previousChunk) < 0) {
      fail('active chunks are not stably ordered');
    }
    previousChunk = chunk.chunk;
  }
  if (snapshot.activeChunkCount !== activeKeys.size) fail('active chunk count mismatch');
  if (snapshot.structural.activeChunks !== activeKeys.size)
    fail('structural active chunk count mismatch');
  if (snapshot.structural.allocatedChunks !== activeKeys.size)
    fail('allocated chunk count mismatch');
  for (const chunk of snapshot.activeChunks) {
    if (
      chunk.rightOfWayRevision < 0 ||
      chunk.staticTopologyRevision < 0 ||
      (chunk.rightOfWayBufferAllocated && chunk.rightOfWayRevision === 0)
    ) {
      fail(`static topology revisions are invalid for ${chunk.key}`);
    }
  }

  const rowKeys = new Set<string>();
  let previousRowChunk: { readonly x: number; readonly y: number } | undefined;
  for (const rowChunk of snapshot.rightOfWay) {
    if (!activeKeys.has(rowChunk.key)) fail(`ROW chunk is inactive ${rowChunk.key}`);
    if (rowChunk.key !== chunkKey(rowChunk.chunk)) fail(`ROW chunk key mismatch ${rowChunk.key}`);
    if (previousRowChunk !== undefined && compareChunks(rowChunk.chunk, previousRowChunk) <= 0) {
      fail('ROW chunks are not stably ordered');
    }
    previousRowChunk = rowChunk.chunk;
    const activeSummary = snapshot.activeChunks.find(({ key }) => key === rowChunk.key);
    if (activeSummary?.rightOfWayRevision !== rowChunk.revision) {
      fail(`ROW revision mismatch for ${rowChunk.key}`);
    }
    let previousCell: { readonly x: number; readonly y: number } | undefined;
    for (const cell of rowChunk.cells) {
      const key = `${String(cell.x)},${String(cell.y)}`;
      if (rowKeys.has(key)) fail(`duplicate ROW cell ${key}`);
      rowKeys.add(key);
      if (!active(snapshot, cell)) fail(`ROW cell is inactive ${key}`);
      if (
        previousCell !== undefined &&
        (cell.y < previousCell.y || (cell.y === previousCell.y && cell.x <= previousCell.x))
      ) {
        fail(`ROW cells are not stably ordered in ${rowChunk.key}`);
      }
      previousCell = cell;
    }
  }
  if (snapshot.structural.rightOfWayCells !== rowKeys.size) fail('ROW cell count mismatch');
  if (snapshot.structural.rightOfWayCellsAdded < rowKeys.size) {
    fail('ROW additions are below the current ROW count');
  }
  if (snapshot.structural.rightOfWayRevisionChanges < 0) fail('ROW revision counter is negative');

  const buildingIds = new Set<string>();
  const occupiedCells = new Set<string>();
  const reservedCells = new Set<string>();
  const circulationCells = new Set<string>(rowKeys);
  const capacityByType = new Map<'home' | 'workplace', number>([
    ['home', 0],
    ['workplace', 0],
  ]);
  const homeOccupancy = new Map<string, number>();
  const workplaceOccupancy = new Map<string, number>();
  for (const building of snapshot.buildings) {
    if (buildingIds.has(building.id)) fail(`duplicate building id ${building.id}`);
    buildingIds.add(building.id);
    const typeCapacity = capacityByType.get(building.type);
    if (typeCapacity === undefined) fail(`unsupported building type ${building.type}`);
    else capacityByType.set(building.type, typeCapacity + building.capacity);
    if (!Number.isSafeInteger(building.capacity) || building.capacity < 0) {
      fail(`building ${building.id} has invalid capacity`);
    }
    if (!isExteriorEntrance(building.entrance, building.footprint)) {
      fail(`building ${building.id} entrance is not exterior`);
    }
    for (const cell of footprintCells(building.footprint)) {
      if (!active(snapshot, cell)) fail(`building ${building.id} leaves active chunks`);
      const cellKey = `${String(cell.x)},${String(cell.y)}`;
      if (rowKeys.has(cellKey)) fail(`building ${building.id} consumes ROW at ${cellKey}`);
      if (occupiedCells.has(cellKey)) fail(`building footprints overlap at ${cellKey}`);
      occupiedCells.add(cellKey);
    }
    for (const cell of circulationEnvelopeCells(building.footprint)) {
      if (!active(snapshot, cell)) fail(`building ${building.id} envelope leaves active chunks`);
      circulationCells.add(`${String(cell.x)},${String(cell.y)}`);
      if (rowKeys.has(`${String(cell.x)},${String(cell.y)}`)) continue;
      for (const other of snapshot.buildings) {
        if (other.id === building.id) continue;
        if (footprintCells(other.footprint).some(({ x, y }) => x === cell.x && y === cell.y)) {
          fail(`building envelopes overlap at ${String(cell.x)},${String(cell.y)}`);
        }
      }
    }
    if (!active(snapshot, building.entrance)) fail(`building ${building.id} entrance is inactive`);
  }

  const occupancyIds = new Set<string>();
  for (const entry of snapshot.occupancy) {
    if (occupancyIds.has(entry.buildingId)) {
      fail(`duplicate occupancy entry ${entry.buildingId}`);
    }
    occupancyIds.add(entry.buildingId);
    const building = snapshot.buildings.find(({ id }) => id === entry.buildingId);
    if (building === undefined) {
      fail(`occupancy references missing building ${entry.buildingId}`);
      continue;
    }
    if (entry.buildingType !== building.type) {
      fail(`occupancy type mismatch for ${entry.buildingId}`);
    }
    if (
      entry.occupied !== entry.occupancy ||
      entry.capacity !== building.capacity ||
      entry.occupied < 0 ||
      entry.occupied > entry.capacity ||
      entry.available !== entry.capacity - entry.occupied
    ) {
      fail(`occupancy is invalid for ${entry.buildingId}`);
    }
  }
  if (occupancyIds.size !== buildingIds.size) fail('occupancy does not cover buildings');

  const projectIds = new Set<string>();
  const projectWorkerCounts = new Map<string, number>();
  const projectConstructingCounts = new Map<string, number>();
  for (const project of snapshot.constructionProjects) {
    if (projectIds.has(project.id)) fail(`duplicate construction project id ${project.id}`);
    projectIds.add(project.id);
    if (!CONSTRUCTION_PHASE_ORDER.includes(project.phase)) {
      fail(`construction project ${project.id} has invalid phase ${project.phase}`);
    }
    if (project.phaseTicksRemaining < 1 || project.phaseTicksElapsed < 0) {
      fail(`construction project ${project.id} has invalid phase timing`);
    }
    if (
      !Number.isSafeInteger(project.phaseLaborCompleted) ||
      !Number.isSafeInteger(project.phaseLaborRequired) ||
      project.phaseLaborRequired < 1 ||
      project.phaseLaborCompleted < 0 ||
      project.phaseLaborCompleted > project.phaseLaborRequired ||
      !Number.isSafeInteger(project.workerCount) ||
      project.workerCount < 0
    ) {
      fail(`construction project ${project.id} has invalid labor state`);
    }
    if (project.stagingCells.length !== 3) {
      fail(`construction project ${project.id} does not have exactly three staging cells`);
    }
    const stagingKeys = new Set<string>();
    for (const staging of project.stagingCells) {
      const stagingKey = `${String(staging.x)},${String(staging.y)}`;
      if (stagingKeys.has(stagingKey)) fail(`construction project ${project.id} repeats staging`);
      stagingKeys.add(stagingKey);
      if (!rowKeys.has(stagingKey)) fail(`construction project ${project.id} staging is not ROW`);
      if (occupiedCells.has(stagingKey) || reservedCells.has(stagingKey)) {
        fail(`construction project ${project.id} staging enters a footprint`);
      }
    }
    projectWorkerCounts.set(project.id, 0);
    projectConstructingCounts.set(project.id, 0);
    if (!isExteriorEntrance(project.entrance, project.footprint)) {
      fail(`construction project ${project.id} entrance is not exterior`);
    }
    if (!active(snapshot, project.entrance)) {
      fail(`construction project ${project.id} entrance is inactive`);
    }
    for (const cell of footprintCells(project.footprint)) {
      if (!active(snapshot, cell)) fail(`construction project ${project.id} leaves active chunks`);
      const cellKey = `${String(cell.x)},${String(cell.y)}`;
      if (occupiedCells.has(cellKey))
        fail(`construction project overlaps a building at ${cellKey}`);
      if (reservedCells.has(cellKey)) fail(`construction projects overlap at ${cellKey}`);
      reservedCells.add(cellKey);
    }
    for (const cell of circulationEnvelopeCells(project.footprint)) {
      if (!active(snapshot, cell))
        fail(`construction project ${project.id} envelope leaves active chunks`);
      circulationCells.add(`${String(cell.x)},${String(cell.y)}`);
      if (rowKeys.has(`${String(cell.x)},${String(cell.y)}`)) continue;
      if (occupiedCells.has(`${String(cell.x)},${String(cell.y)}`)) {
        fail(`construction project ${project.id} envelope overlaps a building`);
      }
    }
    for (const cell of project.connector ?? []) {
      const key = `${String(cell.x)},${String(cell.y)}`;
      if (!rowKeys.has(key)) fail(`construction project ${project.id} connector is not ROW`);
      if (occupiedCells.has(key) || reservedCells.has(key)) {
        fail(`construction project ${project.id} connector enters a footprint`);
      }
      circulationCells.add(key);
    }
    if (occupiedCells.has(`${String(project.entrance.x)},${String(project.entrance.y)}`)) {
      fail(`construction project ${project.id} entrance is blocked`);
    }
  }

  const demandKeys = new Set<string>();
  for (const chunk of snapshot.demand.chunks) {
    demandKeys.add(chunk.key);
    if (!activeKeys.has(chunk.key)) fail(`demand summary is inactive ${chunk.key}`);
    if (chunk.cellCount !== snapshot.chunkSize * snapshot.chunkSize) {
      fail(`demand summary cell count is invalid for ${chunk.key}`);
    }
    for (const value of Object.values(chunk.totals)) {
      if (!Number.isFinite(value) || value < 0 || value > snapshot.chunkSize * snapshot.chunkSize) {
        fail(`demand total is invalid for ${chunk.key}`);
      }
    }
  }
  if (demandKeys.size !== activeKeys.size) fail('demand summaries do not cover active chunks');
  for (const value of Object.values(snapshot.demand.totals)) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > snapshot.activeChunkCount * snapshot.chunkSize * snapshot.chunkSize
    ) {
      fail('global demand total is invalid');
    }
  }

  let previousTrafficKey: string | undefined;
  let currentWindowTrafficEvents = 0;
  for (const edge of snapshot.traffic) {
    if (previousTrafficKey !== undefined && compareStrings(edge.key, previousTrafficKey) <= 0) {
      fail('traffic edges are not stably ordered');
    }
    previousTrafficKey = edge.key;
    try {
      const canonical = canonicalTrafficEdge(edge.a, edge.b);
      if (canonical.key !== edge.key) fail(`traffic edge key mismatch ${edge.key}`);
    } catch {
      fail(`traffic edge ${edge.key} is invalid`);
    }
    if (
      !Number.isSafeInteger(edge.aToB) ||
      !Number.isSafeInteger(edge.bToA) ||
      !Number.isSafeInteger(edge.total) ||
      edge.aToB < 0 ||
      edge.bToA < 0 ||
      edge.total < 1 ||
      edge.aToB + edge.bToA !== edge.total
    ) {
      fail(`traffic edge ${edge.key} has invalid counts`);
    }
    currentWindowTrafficEvents += edge.total;
  }
  if (snapshot.structural.activeTrafficEdges !== snapshot.traffic.length) {
    fail('active traffic edge count mismatch');
  }
  if (
    snapshot.structural.trafficTraversalEventsRecorded !==
    currentWindowTrafficEvents + snapshot.structural.trafficExpiredTraversalEvents
  ) {
    fail('traffic traversal counts do not reconcile');
  }
  if (snapshot.structural.trafficPeakActiveEdges < snapshot.structural.activeTrafficEdges) {
    fail('traffic peak active edge count is below the active count');
  }
  if (
    snapshot.structural.trafficExpiredTraversalEvents < 0 ||
    snapshot.structural.trafficExpiredBuckets < 0
  ) {
    fail('traffic expiry counters are negative');
  }
  if (
    snapshot.structural.trafficTraversalEventsRecorded !==
    snapshot.structural.movementCommittedMoves
  ) {
    fail('traffic traversal count does not equal committed movement count');
  }
  if (
    snapshot.structural.movementProposals !==
    snapshot.structural.movementCommittedMoves + snapshot.structural.movementBlockedMoves
  ) {
    fail('movement proposals do not reconcile with committed and blocked moves');
  }
  if (
    snapshot.structural.movementTargetConflicts > snapshot.structural.movementBlockedMoves ||
    snapshot.structural.movementDependencyBlocks > snapshot.structural.movementBlockedMoves ||
    snapshot.structural.movementOrdinarySwapsRejected > snapshot.structural.movementBlockedMoves
  ) {
    fail('movement conflict counters exceed blocked moves');
  }

  const citizenIds = new Set<string>();
  const movingCells = new Set<string>();
  const validActivities = new Set([
    'home',
    'commuting-to-work',
    'work',
    'commuting-home',
    'commuting-to-construction',
    'constructing',
  ]);
  for (const citizen of snapshot.citizens) {
    if (citizenIds.has(citizen.id)) fail(`duplicate citizen id ${citizen.id}`);
    citizenIds.add(citizen.id);
    if (!active(snapshot, citizen.position)) fail(`citizen ${citizen.id} is inactive`);
    if (!active(snapshot, citizen.previousPosition)) {
      fail(`citizen ${citizen.id} previous position is inactive`);
    }
    if (
      occupiedCells.has(`${String(citizen.position.x)},${String(citizen.position.y)}`) ||
      reservedCells.has(`${String(citizen.position.x)},${String(citizen.position.y)}`)
    ) {
      fail(`citizen ${citizen.id} occupies a building interior`);
    }
    const home = snapshot.buildings.find(({ id }) => id === citizen.homeBuildingId);
    const workplace = snapshot.buildings.find(({ id }) => id === citizen.workplaceBuildingId);
    if (home === undefined) fail(`citizen ${citizen.id} has no home`);
    else {
      if (home.type !== 'home') fail(`citizen ${citizen.id} home has invalid type`);
      homeOccupancy.set(home.id, (homeOccupancy.get(home.id) ?? 0) + 1);
    }
    if (workplace === undefined) fail(`citizen ${citizen.id} has no workplace`);
    else {
      if (workplace.type !== 'workplace') fail(`citizen ${citizen.id} workplace has invalid type`);
      workplaceOccupancy.set(workplace.id, (workplaceOccupancy.get(workplace.id) ?? 0) + 1);
    }
    if (!validActivities.has(citizen.activity)) fail(`citizen ${citizen.id} has invalid activity`);
    if (
      !Number.isSafeInteger(citizen.activityTicksRemaining) ||
      citizen.activityTicksRemaining < 0
    ) {
      fail(`citizen ${citizen.id} has invalid schedule state`);
    }
    if (!Number.isSafeInteger(citizen.waitTicks) || citizen.waitTicks < 0) {
      fail(`citizen ${citizen.id} has invalid wait state`);
    }
    if (
      citizen.activity === 'commuting-to-work' ||
      citizen.activity === 'commuting-home' ||
      citizen.activity === 'commuting-to-construction' ||
      citizen.activity === 'constructing'
    ) {
      const movingKey = `${String(citizen.position.x)},${String(citizen.position.y)}`;
      if (movingCells.has(movingKey)) fail(`duplicate moving occupancy at ${movingKey}`);
      movingCells.add(movingKey);
    }
    if (citizen.constructionProjectId !== null) {
      const project = snapshot.constructionProjects.find(
        ({ id }) => id === citizen.constructionProjectId,
      );
      if (project === undefined) {
        fail(`citizen ${citizen.id} references missing construction project`);
      } else {
        projectWorkerCounts.set(project.id, (projectWorkerCounts.get(project.id) ?? 0) + 1);
        const constructionStagingCell = citizen.constructionStagingCell;
        if (constructionStagingCell === null) {
          fail(`citizen ${citizen.id} has no construction staging assignment`);
        } else if (
          !project.stagingCells.some(
            (cell) => cell.x === constructionStagingCell.x && cell.y === constructionStagingCell.y,
          )
        ) {
          fail(`citizen ${citizen.id} has an invalid construction staging assignment`);
        }
        if (citizen.activity === 'constructing') {
          projectConstructingCounts.set(
            project.id,
            (projectConstructingCounts.get(project.id) ?? 0) + 1,
          );
        }
      }
    } else if (
      citizen.constructionStagingCell !== null ||
      citizen.resumeDestinationBuildingId !== null
    ) {
      fail(`citizen ${citizen.id} has orphaned construction assignment state`);
    }
    if (
      !Number.isSafeInteger(citizen.routeIndex) ||
      citizen.routeIndex < 0 ||
      (citizen.route.length === 0
        ? citizen.routeIndex !== 0
        : citizen.routeIndex >= citizen.route.length)
    ) {
      fail(`citizen ${citizen.id} route index is invalid`);
    }
    for (let index = 0; index < citizen.route.length; index += 1) {
      const position = citizen.route[index];
      if (position === undefined) continue;
      if (!active(snapshot, position)) fail(`citizen ${citizen.id} route leaves active chunks`);
      if (
        occupiedCells.has(`${String(position.x)},${String(position.y)}`) ||
        reservedCells.has(`${String(position.x)},${String(position.y)}`)
      ) {
        fail(`citizen ${citizen.id} route enters a building interior`);
      }
      if (!circulationCells.has(`${String(position.x)},${String(position.y)}`)) {
        fail(`citizen ${citizen.id} route leaves circulation ROW/envelopes`);
      }
      const previous = citizen.route[index - 1];
      if (previous !== undefined && !adjacent(previous, position)) {
        fail(`citizen ${citizen.id} route is non-adjacent`);
      }
    }
  }
  for (const building of snapshot.buildings) {
    const occupied =
      building.type === 'home'
        ? (homeOccupancy.get(building.id) ?? 0)
        : (workplaceOccupancy.get(building.id) ?? 0);
    if (occupied > building.capacity) fail(`building ${building.id} exceeds capacity`);
  }
  for (const project of snapshot.constructionProjects) {
    const workerCount = projectWorkerCounts.get(project.id) ?? 0;
    const constructingCount = projectConstructingCounts.get(project.id) ?? 0;
    if (workerCount !== project.workerCount) {
      fail(`construction project ${project.id} worker count mismatch`);
    }
    if (project.paused !== (constructingCount === 0)) {
      fail(`construction project ${project.id} paused state mismatch`);
    }
  }
  if (!Number.isSafeInteger(snapshot.populationCap) || snapshot.populationCap < 0) {
    fail('population cap is invalid');
  } else if (snapshot.citizens.length > snapshot.populationCap) {
    fail('population cap is exceeded');
  }
  for (const [name, value] of Object.entries(snapshot.metrics)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${name} metric is invalid`);
  }
  if (
    !Number.isFinite(snapshot.averageTripDurationTicks) ||
    snapshot.averageTripDurationTicks < 0
  ) {
    fail('average trip duration is invalid');
  }
  if (!Number.isFinite(snapshot.data) || snapshot.data < 0) fail('Data is invalid');
  if (snapshot.completedTrips < 0 || snapshot.completedActivities < 0) {
    fail('completed counters are negative');
  }
  if (
    snapshot.structural.constructionProjectsCompleted + snapshot.constructionProjects.length !==
    snapshot.structural.constructionProjectsStarted
  ) {
    fail('construction project counts do not reconcile');
  }
  const job = snapshot.developmentJob;
  if (job.anchorChecksThisTick > 512) fail('development anchor budget exceeded');
  if (job.preliminaryCandidatesRetained > 32) fail('development preliminary cap exceeded');
  if (job.finalistsValidatedThisTick > 4) fail('development finalist budget exceeded');
  if (job.corridorExpansionsThisTick > 2_048) fail('development corridor budget exceeded');
  if (snapshot.structural.developmentPeakAnchorChecksPerTick > 512) {
    fail('development peak anchor budget exceeded');
  }
  if (snapshot.structural.developmentPeakFinalistValidationsPerTick > 4) {
    fail('development peak finalist budget exceeded');
  }
  if (snapshot.structural.developmentPeakCorridorExpansionsPerTick > 2_048) {
    fail('development peak corridor budget exceeded');
  }
  return failures;
}

export function runBalance(options: BalanceOptions): BalanceSummary {
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 0) {
    throw new Error('ticks must be a non-negative safe integer.');
  }
  const scenario = options.scenario ?? 'baseline';
  const scenarioConfig = getBalanceScenarioConfig(scenario);
  const scheduledCommands = [
    ...getBalanceScenarioCommands(scenario),
    ...(options.commands ?? []),
  ].map((scheduled, index) => ({ ...scheduled, order: index }));
  const scheduledActivations = [
    ...getBalanceScenarioActivations(scenario),
    ...(options.activations ?? []),
  ].map((scheduled, index) => ({ ...scheduled, order: index }));
  for (const scheduled of [...scheduledCommands, ...scheduledActivations]) {
    if (!Number.isSafeInteger(scheduled.tick) || scheduled.tick < 0) {
      throw new Error(
        `Schedule tick must be a non-negative safe integer; received ${String(scheduled.tick)}.`,
      );
    }
  }
  scheduledCommands.sort((left, right) => left.tick - right.tick || left.order - right.order);
  scheduledActivations.sort((left, right) => left.tick - right.tick || left.order - right.order);
  const simulation = createSimulation({
    ...scenarioConfig,
    seed: options.seed,
    ...(options.citizenCount === undefined ? {} : { citizenCount: options.citizenCount }),
    ...(options.initialPopulation === undefined
      ? {}
      : { initialPopulation: options.initialPopulation }),
    ...(options.populationCap === undefined ? {} : { populationCap: options.populationCap }),
    ...(options.populationGrowthCadenceTicks === undefined
      ? {}
      : { populationGrowthCadenceTicks: options.populationGrowthCadenceTicks }),
  });
  const invariantFailures = new Set<string>();
  const commandResults: BalanceCommandResult[] = [];
  const activationResults: BalanceActivationResult[] = [];
  let observedWaitTicks = 0;
  let observedWaitSamples = 0;
  let observedMaxWaitTicks = 0;
  let nextScheduledCommand = 0;
  let nextScheduledActivation = 0;
  const applyScheduled = (): void => {
    const currentTick = simulation.getSnapshot().tick;
    while (nextScheduledActivation < scheduledActivations.length) {
      const scheduled = scheduledActivations[nextScheduledActivation];
      if (scheduled === undefined || scheduled.tick > currentTick) break;
      const command = { ...scheduled.command };
      activationResults.push({
        tick: currentTick,
        command,
        result: simulation.activateChunk(command),
      });
      nextScheduledActivation += 1;
    }
    while (nextScheduledCommand < scheduledCommands.length) {
      const scheduled = scheduledCommands[nextScheduledCommand];
      if (scheduled === undefined || scheduled.tick > currentTick) break;
      const command = { ...scheduled.command, position: { ...scheduled.command.position } };
      const preview = simulation.getDistrictSeedPlacementInfo(command);
      commandResults.push({
        tick: currentTick,
        command,
        preview,
        result: simulation.placeDistrictSeed(command),
      });
      nextScheduledCommand += 1;
    }
  };
  const recordInvariantFailures = (label: string, snapshot: SimulationSnapshot): void => {
    for (const citizen of snapshot.citizens) {
      observedWaitTicks += citizen.waitTicks;
      observedWaitSamples += 1;
      observedMaxWaitTicks = Math.max(observedMaxWaitTicks, citizen.waitTicks);
    }
    for (const failure of collectInvariantFailures(snapshot))
      invariantFailures.add(`${label}: ${failure}`);
  };
  applyScheduled();
  recordInvariantFailures('initial', simulation.getSnapshot());
  for (let tick = 0; tick < options.ticks; tick += 1) {
    try {
      simulation.step();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      invariantFailures.add(`tick ${String(tick + 1)}: ${message}`);
      break;
    }
    applyScheduled();
    recordInvariantFailures(`tick ${String(tick + 1)}`, simulation.getSnapshot());
  }
  const snapshot = simulation.getSnapshot();
  const directionalTraversals = snapshot.traffic.reduce(
    (total, edge) => total + edge.aToB + edge.bToA,
    0,
  );
  const totalTraversals = snapshot.traffic.reduce((total, edge) => total + edge.total, 0);
  const movement: BalanceMovementSummary = {
    proposals: snapshot.structural.movementProposals,
    committedMoves: snapshot.structural.movementCommittedMoves,
    blockedMoves: snapshot.structural.movementBlockedMoves,
    averageWaitTicks: observedWaitSamples === 0 ? 0 : observedWaitTicks / observedWaitSamples,
    maxWaitTicks: observedMaxWaitTicks,
    targetConflicts: snapshot.structural.movementTargetConflicts,
    dependencyBlocks: snapshot.structural.movementDependencyBlocks,
    cyclesCommitted: snapshot.structural.movementCyclesCommitted,
    ordinarySwapsRejected: snapshot.structural.movementOrdinarySwapsRejected,
    replansAttempted: snapshot.structural.movementReplansAttempted,
    replansSucceeded: snapshot.structural.movementReplansSucceeded,
    emergencySwaps: snapshot.structural.movementDeadlockRecoveries,
  };
  const construction: BalanceConstructionSummary = {
    assignmentsOffered: snapshot.structural.constructionAssignmentsOffered,
    assignmentsAccepted: snapshot.structural.constructionAssignmentsAccepted,
    constructionCommutes: snapshot.structural.constructionCommutes,
    workerArrivals: snapshot.structural.constructionWorkerArrivals,
    laborUnits: snapshot.structural.constructionLaborUnits,
    pausedProjectTicks: snapshot.structural.constructionPausedProjectTicks,
    phaseCompletions: snapshot.structural.constructionPhaseCompletions,
    workerReleases: snapshot.structural.constructionWorkerReleases,
  };
  return {
    scenario,
    seed: options.seed,
    ticks: options.ticks,
    citizenCount: snapshot.citizens.length,
    populationCap: snapshot.populationCap,
    populationGrowthCadenceTicks: snapshot.populationGrowthCadenceTicks,
    completedTrips: snapshot.completedTrips,
    completedActivities: snapshot.completedActivities,
    data: snapshot.data,
    dataGeneratedThisTick: snapshot.dataGeneratedThisTick,
    averageTripDurationTicks: snapshot.averageTripDurationTicks,
    metrics: snapshot.metrics,
    demandTotals: snapshot.demand.totals,
    seeds: snapshot.seeds,
    activeChunkCount: snapshot.activeChunkCount,
    movement,
    construction,
    traffic: snapshot.traffic,
    activeTrafficEdges: snapshot.structural.activeTrafficEdges,
    directionalTraversals,
    totalTraversals,
    trafficTraversalEventsRecorded: snapshot.structural.trafficTraversalEventsRecorded,
    expiredTraversalEvents: snapshot.structural.trafficExpiredTraversalEvents,
    peakActiveEdges: snapshot.structural.trafficPeakActiveEdges,
    structuralCounters: snapshot.structural,
    snapshotChunkSummaries: snapshot.structural.snapshotChunkSummaries,
    snapshotTrafficSummaries: snapshot.traffic.length,
    commandResults,
    activationResults,
    buildingCount: snapshot.buildings.length,
    homeCount: snapshot.buildings.filter((building) => building.type === 'home').length,
    workplaceCount: snapshot.buildings.filter((building) => building.type === 'workplace').length,
    activeConstructionProjects: snapshot.constructionProjects.length,
    constructionProjectsStarted: snapshot.structural.constructionProjectsStarted,
    constructionProjectsCompleted: snapshot.structural.constructionProjectsCompleted,
    developmentEvaluations: snapshot.structural.developmentEvaluations,
    developmentJob: snapshot.developmentJob,
    invariantFailures: [...invariantFailures],
    determinismHash: simulation.getDeterminismHash(),
  };
}
