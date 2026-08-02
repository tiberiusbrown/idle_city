import {
  CONSTRUCTION_PHASE_ORDER,
  chunkCoordinateForPosition,
  chunkKey,
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
  type PlaceDistrictSeedCommand,
  type SimulationConfig,
  type SimulationSnapshot,
  type SimulationStructuralCounters,
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
  'living-led',
  'working-led',
  'equal-score',
  'obstacle-constrained',
  'no-valid-footprint',
  'long-run-construction',
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
      { tick: 0, command: { kind: 'living', position: { x: 3, y: 3 } } },
      { tick: 1, command: { kind: 'working', position: { x: 3, y: 3 } } },
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
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 4, y: 4 } } }],
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
  'living-led': {
    config: { startingData: DISTRICT_SEED_COSTS.living, developmentEvaluationIntervalTicks: 100 },
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 4, y: 4 } } }],
    activations: [],
  },
  'working-led': {
    config: { startingData: DISTRICT_SEED_COSTS.working, developmentEvaluationIntervalTicks: 100 },
    commands: [{ tick: 0, command: { kind: 'working', position: { x: 8, y: 6 } } }],
    activations: [],
  },
  'equal-score': {
    config: {
      startingData: DISTRICT_SEED_COSTS.living + DISTRICT_SEED_COSTS.working,
      developmentEvaluationIntervalTicks: 100,
    },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 4, y: 4 } } },
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
    commands: [{ tick: 0, command: { kind: 'living', position: { x: 4, y: 4 } } }],
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
      { tick: 0, command: { kind: 'living', position: { x: 4, y: 4 } } },
      { tick: 1, command: { kind: 'working', position: { x: 5, y: 4 } } },
    ],
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
  readonly scenario?: BalanceScenarioName;
  readonly commands?: readonly ScheduledDistrictSeedCommand[];
  readonly activations?: readonly ScheduledChunkActivationCommand[];
}

export interface BalanceCommandResult {
  readonly tick: number;
  readonly command: PlaceDistrictSeedCommand;
  readonly result: CommandResult;
}

export interface BalanceActivationResult {
  readonly tick: number;
  readonly command: ActivateChunkCommand;
  readonly result: ChunkActivationResult;
}

export interface BalanceSummary {
  readonly scenario: BalanceScenarioName;
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount: number;
  readonly completedTrips: number;
  readonly completedActivities: number;
  readonly data: number;
  readonly dataGeneratedThisTick: number;
  readonly averageTripDurationTicks: number;
  readonly metrics: CityMetrics;
  readonly demandTotals: DemandTotals;
  readonly seeds: readonly DistrictSeed[];
  readonly activeChunkCount: number;
  readonly structuralCounters: SimulationStructuralCounters;
  readonly snapshotChunkSummaries: number;
  readonly commandResults: readonly BalanceCommandResult[];
  readonly activationResults: readonly BalanceActivationResult[];
  readonly buildingCount: number;
  readonly homeCount: number;
  readonly workplaceCount: number;
  readonly activeConstructionProjects: number;
  readonly constructionProjectsStarted: number;
  readonly constructionProjectsCompleted: number;
  readonly developmentEvaluations: number;
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

  const buildingIds = new Set<string>();
  const occupiedCells = new Set<string>();
  const reservedCells = new Set<string>();
  const capacityByType = new Map<'home' | 'workplace', number>([
    ['home', 0],
    ['workplace', 0],
  ]);
  for (const building of snapshot.buildings) {
    if (buildingIds.has(building.id)) fail(`duplicate building id ${building.id}`);
    buildingIds.add(building.id);
    const typeCapacity = capacityByType.get(building.type);
    if (typeCapacity === undefined) fail(`unsupported building type ${building.type}`);
    else capacityByType.set(building.type, typeCapacity + building.capacity);
    if (!isExteriorEntrance(building.entrance, building.footprint)) {
      fail(`building ${building.id} entrance is not exterior`);
    }
    for (const cell of footprintCells(building.footprint)) {
      if (!active(snapshot, cell)) fail(`building ${building.id} leaves active chunks`);
      const cellKey = `${String(cell.x)},${String(cell.y)}`;
      if (occupiedCells.has(cellKey)) fail(`building footprints overlap at ${cellKey}`);
      occupiedCells.add(cellKey);
    }
    if (!active(snapshot, building.entrance)) fail(`building ${building.id} entrance is inactive`);
  }

  const projectIds = new Set<string>();
  for (const project of snapshot.constructionProjects) {
    if (projectIds.has(project.id)) fail(`duplicate construction project id ${project.id}`);
    projectIds.add(project.id);
    if (!CONSTRUCTION_PHASE_ORDER.includes(project.phase)) {
      fail(`construction project ${project.id} has invalid phase ${project.phase}`);
    }
    if (project.phaseTicksRemaining < 1 || project.phaseTicksElapsed < 0) {
      fail(`construction project ${project.id} has invalid phase timing`);
    }
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
      if (!Number.isFinite(value) || value < 0) fail(`demand total is invalid for ${chunk.key}`);
    }
  }
  if (demandKeys.size !== activeKeys.size) fail('demand summaries do not cover active chunks');
  for (const value of Object.values(snapshot.demand.totals)) {
    if (!Number.isFinite(value) || value < 0) fail('global demand total is invalid');
  }

  for (const citizen of snapshot.citizens) {
    if (!active(snapshot, citizen.position)) fail(`citizen ${citizen.id} is inactive`);
    if (
      occupiedCells.has(`${String(citizen.position.x)},${String(citizen.position.y)}`) ||
      reservedCells.has(`${String(citizen.position.x)},${String(citizen.position.y)}`)
    ) {
      fail(`citizen ${citizen.id} occupies a building interior`);
    }
    if (!buildingIds.has(citizen.homeBuildingId)) fail(`citizen ${citizen.id} has no home`);
    if (!buildingIds.has(citizen.workplaceBuildingId))
      fail(`citizen ${citizen.id} has no workplace`);
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
      const previous = citizen.route[index - 1];
      if (previous !== undefined && !adjacent(previous, position)) {
        fail(`citizen ${citizen.id} route is non-adjacent`);
      }
    }
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
  });
  const invariantFailures = new Set<string>();
  const commandResults: BalanceCommandResult[] = [];
  const activationResults: BalanceActivationResult[] = [];
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
      commandResults.push({
        tick: currentTick,
        command,
        result: simulation.placeDistrictSeed(command),
      });
      nextScheduledCommand += 1;
    }
  };
  const recordInvariantFailures = (label: string, snapshot: SimulationSnapshot): void => {
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
  return {
    scenario,
    seed: options.seed,
    ticks: options.ticks,
    citizenCount: snapshot.citizens.length,
    completedTrips: snapshot.completedTrips,
    completedActivities: snapshot.completedActivities,
    data: snapshot.data,
    dataGeneratedThisTick: snapshot.dataGeneratedThisTick,
    averageTripDurationTicks: snapshot.averageTripDurationTicks,
    metrics: snapshot.metrics,
    demandTotals: snapshot.demand.totals,
    seeds: snapshot.seeds,
    activeChunkCount: snapshot.activeChunkCount,
    structuralCounters: snapshot.structural,
    snapshotChunkSummaries: snapshot.structural.snapshotChunkSummaries,
    commandResults,
    activationResults,
    buildingCount: snapshot.buildings.length,
    homeCount: snapshot.buildings.filter((building) => building.type === 'home').length,
    workplaceCount: snapshot.buildings.filter((building) => building.type === 'workplace').length,
    activeConstructionProjects: snapshot.constructionProjects.length,
    constructionProjectsStarted: snapshot.structural.constructionProjectsStarted,
    constructionProjectsCompleted: snapshot.structural.constructionProjectsCompleted,
    developmentEvaluations: snapshot.structural.developmentEvaluations,
    invariantFailures: [...invariantFailures],
    determinismHash: simulation.getDeterminismHash(),
  };
}
