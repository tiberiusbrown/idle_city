import {
  DISTRICT_SEED_COSTS,
  createSimulation,
  type CityMetrics,
  type CommandResult,
  type DemandTotals,
  type DistrictSeed,
  type PlaceDistrictSeedCommand,
  type SimulationConfig,
  type SimulationSnapshot,
} from '@idle-city/simulation';

export const balanceScenarioNames = [
  'baseline',
  'long-commute',
  'capacity-pressure',
  'compact',
  'living-seed',
  'working-seed',
  'rejected-command',
] as const;

export type BalanceScenarioName = (typeof balanceScenarioNames)[number];

export interface ScheduledDistrictSeedCommand {
  /** The simulation tick at which this command is applied; tick 0 is pre-step. */
  readonly tick: number;
  readonly command: PlaceDistrictSeedCommand;
}

interface BalanceScenarioDefinition {
  readonly config: SimulationConfig;
  readonly commands: readonly ScheduledDistrictSeedCommand[];
}

const scenarioDefinitions: Record<BalanceScenarioName, BalanceScenarioDefinition> = {
  baseline: { config: {}, commands: [] },
  'long-commute': { config: { width: 24, height: 24 }, commands: [] },
  'capacity-pressure': {
    config: { housingCapacity: 4, workplaceCapacity: 4 },
    commands: [],
  },
  compact: { config: { width: 5, height: 5 }, commands: [] },
  'living-seed': {
    config: { startingData: DISTRICT_SEED_COSTS.living },
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: 3, y: 3 } } },
      { tick: 1, command: { kind: 'working', position: { x: 3, y: 3 } } },
    ],
  },
  'working-seed': {
    config: { startingData: DISTRICT_SEED_COSTS.working },
    commands: [
      { tick: 0, command: { kind: 'working', position: { x: 8, y: 6 } } },
      { tick: 1, command: { kind: 'services', position: { x: 3, y: 3 } } },
    ],
  },
  'rejected-command': {
    config: {},
    commands: [
      { tick: 0, command: { kind: 'living', position: { x: -1, y: 0 } } },
      { tick: 1, command: { kind: 'services', position: { x: 3, y: 3 } } },
      { tick: 2, command: { kind: 'working', position: { x: 4, y: 4 } } },
    ],
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

export interface BalanceOptions {
  readonly seed: number;
  readonly ticks: number;
  readonly citizenCount?: number;
  readonly scenario?: BalanceScenarioName;
  readonly commands?: readonly ScheduledDistrictSeedCommand[];
}

export interface BalanceCommandResult {
  readonly tick: number;
  readonly command: PlaceDistrictSeedCommand;
  readonly result: CommandResult;
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
  readonly commandResults: readonly BalanceCommandResult[];
  readonly invariantFailures: readonly string[];
  readonly determinismHash: string;
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return (
    Number.isSafeInteger(x) &&
    Number.isSafeInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height
  );
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
  const buildingIds = new Set<string>();
  for (const building of snapshot.buildings) {
    if (buildingIds.has(building.id)) fail(`duplicate building id ${building.id}`);
    buildingIds.add(building.id);
    if (!inBounds(building.position.x, building.position.y, snapshot.width, snapshot.height)) {
      fail(`building ${building.id} is out of bounds`);
    }
    if (!Number.isFinite(building.capacity) || building.capacity < 0) {
      fail(`building ${building.id} has invalid capacity`);
    }
  }

  const seedIds = new Set<string>();
  const seedCells = new Set<string>();
  for (const seed of snapshot.seeds) {
    if (seedIds.has(seed.id)) fail(`duplicate district seed id ${seed.id}`);
    seedIds.add(seed.id);
    if (!inBounds(seed.position.x, seed.position.y, snapshot.width, snapshot.height)) {
      fail(`district seed ${seed.id} is out of bounds`);
    }
    const cellKey = `${String(seed.position.x)},${String(seed.position.y)}`;
    if (seedCells.has(cellKey)) fail(`duplicate district seed cell ${cellKey}`);
    seedCells.add(cellKey);
    const seedKind: unknown = seed.kind;
    if (seedKind !== 'living' && seedKind !== 'working' && seedKind !== 'services') {
      fail(`district seed ${seed.id} has an unsupported kind`);
    }
  }

  if (snapshot.demand.cells.length !== snapshot.width * snapshot.height) {
    fail('demand cell count does not cover the grid');
  }
  snapshot.demand.cells.forEach((cell, index) => {
    const expectedX = index % snapshot.width;
    const expectedY = Math.floor(index / snapshot.width);
    if (cell.position.x !== expectedX || cell.position.y !== expectedY) {
      fail('demand cells are not in row-major order');
    }
    for (const [kind, value] of Object.entries({
      living: cell.living,
      working: cell.working,
      services: cell.services,
    })) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        fail(`${kind} demand is not finite and bounded`);
      }
    }
  });
  for (const [kind, value] of Object.entries(snapshot.demand.totals)) {
    if (!Number.isFinite(value) || value < 0) fail(`${kind} demand total is invalid`);
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

  for (const citizen of snapshot.citizens) {
    if (!inBounds(citizen.position.x, citizen.position.y, snapshot.width, snapshot.height)) {
      fail(`citizen ${citizen.id} is out of bounds`);
    }
    if (!buildingIds.has(citizen.homeBuildingId)) {
      fail(`citizen ${citizen.id} has a missing home`);
    }
    if (!buildingIds.has(citizen.workplaceBuildingId)) {
      fail(`citizen ${citizen.id} has a missing workplace`);
    }
    if (citizen.route.length === 0) {
      if (citizen.routeIndex !== 0) fail(`citizen ${citizen.id} has an invalid empty route index`);
    } else if (citizen.routeIndex < 0 || citizen.routeIndex >= citizen.route.length) {
      fail(`citizen ${citizen.id} has an invalid route index`);
    }
    for (let index = 0; index < citizen.route.length; index += 1) {
      const position = citizen.route[index];
      if (position === undefined) continue;
      if (!inBounds(position.x, position.y, snapshot.width, snapshot.height)) {
        fail(`citizen ${citizen.id} route leaves the grid`);
      }
      const previous = citizen.route[index - 1];
      if (previous !== undefined && !adjacent(previous, position)) {
        fail(`citizen ${citizen.id} route is non-adjacent`);
      }
    }
  }
  return failures;
}

export function runBalance(options: BalanceOptions): BalanceSummary {
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 0)
    throw new Error('ticks must be a non-negative safe integer.');
  const scenario = options.scenario ?? 'baseline';
  const scenarioConfig = getBalanceScenarioConfig(scenario);
  const scheduledCommands = [
    ...getBalanceScenarioCommands(scenario),
    ...(options.commands ?? []),
  ].map((scheduled, index) => ({ ...scheduled, order: index }));
  for (const scheduled of scheduledCommands) {
    if (!Number.isSafeInteger(scheduled.tick) || scheduled.tick < 0) {
      throw new Error(
        `Command schedule tick must be a non-negative safe integer; received ${String(scheduled.tick)}.`,
      );
    }
  }
  scheduledCommands.sort((left, right) => left.tick - right.tick || left.order - right.order);
  const simulation = createSimulation({
    ...scenarioConfig,
    seed: options.seed,
    ...(options.citizenCount === undefined ? {} : { citizenCount: options.citizenCount }),
  });
  const invariantFailures = new Set<string>();
  const commandResults: BalanceCommandResult[] = [];
  let nextScheduledCommand = 0;
  const applyScheduledCommands = (): void => {
    const currentTick = simulation.getSnapshot().tick;
    while (nextScheduledCommand < scheduledCommands.length) {
      const scheduled = scheduledCommands[nextScheduledCommand];
      if (scheduled === undefined || scheduled.tick > currentTick) return;
      const command: PlaceDistrictSeedCommand = {
        kind: scheduled.command.kind,
        position: { ...scheduled.command.position },
      };
      const result = simulation.placeDistrictSeed(command);
      commandResults.push({ tick: currentTick, command, result });
      nextScheduledCommand += 1;
    }
  };
  const recordInvariantFailures = (label: string, snapshot: SimulationSnapshot): void => {
    for (const failure of collectInvariantFailures(snapshot)) {
      invariantFailures.add(`${label}: ${failure}`);
    }
  };
  applyScheduledCommands();
  recordInvariantFailures('initial', simulation.getSnapshot());
  for (let tick = 0; tick < options.ticks; tick += 1) {
    try {
      simulation.step();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      invariantFailures.add(`tick ${String(tick + 1)}: ${message}`);
      break;
    }
    applyScheduledCommands();
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
    commandResults,
    invariantFailures: [...invariantFailures],
    determinismHash: simulation.getDeterminismHash(),
  };
}
