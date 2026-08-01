import { positionsEqual, stableHash, type GridPosition } from '@idle-city/shared';
import { calculateCityDemand } from './demand';
import { findGridPath } from './pathfinding';
import { SeededRandom } from './random';
import type {
  Building,
  CitizenActivity,
  CitizenSnapshot,
  CityMetrics,
  Simulation,
  SimulationConfig,
  SimulationSnapshot,
} from './types';

interface CitizenState {
  id: string;
  position: GridPosition;
  previousPosition: GridPosition;
  homeBuildingId: string;
  workplaceBuildingId: string;
  activity: CitizenActivity;
  activityTicksRemaining: number;
  route: GridPosition[];
  routeIndex: number;
  tripStartedTick: number | null;
}

const defaults = {
  width: 12,
  height: 10,
  seed: 1,
  citizenCount: 10,
  activityDurationTicks: 3,
} as const;

function positiveInteger(name: string, value: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer of at least ${String(minimum)}; received ${String(value)}.`,
    );
  }
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer; received ${String(value)}.`);
  }
  return value;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function manhattanDistance(left: GridPosition, right: GridPosition): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function roundData(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function dataEfficiency(metrics: CityMetrics): number {
  // Keep a struggling city progressing while rewarding healthy space, access,
  // and productive activity. The result is always in the bounded range 0.5..1.
  return 0.5 + (metrics.space + metrics.access + metrics.activity) / 6;
}

export function createSimulation(config: SimulationConfig = {}): Simulation {
  const width = positiveInteger('width', config.width ?? defaults.width, 5);
  const height = positiveInteger('height', config.height ?? defaults.height, 5);
  const seed = config.seed ?? defaults.seed;
  const citizenCount = positiveInteger(
    'citizenCount',
    config.citizenCount ?? defaults.citizenCount,
  );
  const activityDurationTicks = positiveInteger(
    'activityDurationTicks',
    config.activityDurationTicks ?? defaults.activityDurationTicks,
  );
  const housingCapacity = nonNegativeInteger(
    'housingCapacity',
    config.housingCapacity ?? citizenCount,
  );
  const workplaceCapacity = nonNegativeInteger(
    'workplaceCapacity',
    config.workplaceCapacity ?? citizenCount,
  );
  const random = new SeededRandom(seed);
  const homeBuilding: Building = {
    id: 'home-1',
    type: 'home',
    position: { x: 2, y: 2 },
    capacity: housingCapacity,
  };
  const workplaceBuilding: Building = {
    id: 'workplace-1',
    type: 'workplace',
    position: { x: width - 3, y: height - 3 },
    capacity: workplaceCapacity,
  };
  const buildings: Building[] = [homeBuilding, workplaceBuilding];
  const citizens: CitizenState[] = Array.from({ length: citizenCount }, (_, index) => ({
    id: `citizen-${String(index + 1)}`,
    position: { ...homeBuilding.position },
    previousPosition: { ...homeBuilding.position },
    homeBuildingId: homeBuilding.id,
    workplaceBuildingId: workplaceBuilding.id,
    activity: 'home',
    activityTicksRemaining: 1 + random.nextInteger(activityDurationTicks),
    route: [],
    routeIndex: 0,
    tripStartedTick: null,
  }));
  let tick = 0;
  let completedTrips = 0;
  let completedActivities = 0;
  let totalTripDurationTicks = 0;
  let data = 0;
  let dataGeneratedThisTick = 0;

  const buildingById = (id: string): Building => {
    const building = buildings.find((candidate) => candidate.id === id);
    if (building === undefined) throw new Error(`Citizen references missing building ${id}.`);
    return building;
  };

  const calculateMetrics = (): {
    readonly metrics: CityMetrics;
    readonly averageTripDurationTicks: number;
  } => {
    const population = citizens.length;
    const housingCapacity = buildings
      .filter((building) => building.type === 'home')
      .reduce((total, building) => total + building.capacity, 0);
    const workplaceCapacity = buildings
      .filter((building) => building.type === 'workplace')
      .reduce((total, building) => total + building.capacity, 0);
    const space =
      population === 0
        ? 1
        : clampUnit(Math.min(housingCapacity / population, workplaceCapacity / population));

    const plannedTripDistances = citizens.map((citizen) =>
      manhattanDistance(
        buildingById(citizen.homeBuildingId).position,
        buildingById(citizen.workplaceBuildingId).position,
      ),
    );
    const plannedAverageTripDuration =
      plannedTripDistances.length === 0
        ? 0
        : plannedTripDistances.reduce((total, distance) => total + distance, 0) /
          plannedTripDistances.length;
    const averageTripDurationTicks =
      completedTrips === 0 ? plannedAverageTripDuration : totalTripDurationTicks / completedTrips;
    const longestGridTrip = Math.max(1, width + height - 2);
    const access = clampUnit(1 - averageTripDurationTicks / longestGridTrip);

    const productiveCitizens = citizens.filter((citizen) => citizen.activity === 'work').length;
    const activity = population === 0 ? 1 : productiveCitizens / population;
    return {
      metrics: { space, access, activity },
      averageTripDurationTicks,
    };
  };

  const completeTrip = (citizen: CitizenState, destinationId: string): void => {
    const destination = buildingById(destinationId);
    if (!positionsEqual(citizen.position, destination.position)) {
      throw new Error(`Citizen ${citizen.id} did not reach the expected destination.`);
    }
    if (citizen.tripStartedTick === null) {
      throw new Error(`Citizen ${citizen.id} completed a trip without a start tick.`);
    }
    totalTripDurationTicks += tick - citizen.tripStartedTick;
    citizen.activity = citizen.activity === 'commuting-to-work' ? 'work' : 'home';
    citizen.activityTicksRemaining = activityDurationTicks;
    citizen.tripStartedTick = null;
    completedTrips += 1;
  };

  const startTrip = (
    citizen: CitizenState,
    activity: CitizenActivity,
    destinationId: string,
  ): void => {
    const destination = buildingById(destinationId);
    citizen.activity = activity;
    citizen.route = findGridPath({ width, height }, citizen.position, destination.position);
    citizen.routeIndex = 0;
    citizen.tripStartedTick = tick;
    if (citizen.route.length === 1) completeTrip(citizen, destinationId);
  };

  const advanceCitizen = (citizen: CitizenState): void => {
    citizen.previousPosition = { ...citizen.position };
    if (citizen.activity === 'home' || citizen.activity === 'work') {
      citizen.activityTicksRemaining -= 1;
      if (citizen.activityTicksRemaining <= 0) {
        if (citizen.activity === 'home') {
          startTrip(citizen, 'commuting-to-work', citizen.workplaceBuildingId);
        } else {
          completedActivities += 1;
          startTrip(citizen, 'commuting-home', citizen.homeBuildingId);
        }
      }
      return;
    }

    const nextIndex = citizen.routeIndex + 1;
    const next = citizen.route[nextIndex];
    if (next === undefined) throw new Error(`Citizen ${citizen.id} has an incomplete route.`);
    const distance = Math.abs(next.x - citizen.position.x) + Math.abs(next.y - citizen.position.y);
    if (distance !== 1)
      throw new Error(`Citizen ${citizen.id} route contains a non-adjacent move.`);
    citizen.position = { ...next };
    citizen.routeIndex = nextIndex;
    if (citizen.routeIndex === citizen.route.length - 1) {
      const destinationId =
        citizen.activity === 'commuting-to-work'
          ? citizen.workplaceBuildingId
          : citizen.homeBuildingId;
      completeTrip(citizen, destinationId);
    }
  };

  const snapshot = (): SimulationSnapshot => {
    const { metrics, averageTripDurationTicks } = calculateMetrics();
    return {
      width,
      height,
      seed,
      tick,
      randomState: random.getState(),
      completedTrips,
      completedActivities,
      data,
      dataGeneratedThisTick,
      averageTripDurationTicks,
      metrics,
      demand: calculateCityDemand({ width, height, buildings, citizens, metrics }),
      buildings: buildings.map((building) => ({ ...building, position: { ...building.position } })),
      citizens: citizens.map((citizen): CitizenSnapshot => ({
        id: citizen.id,
        position: { ...citizen.position },
        previousPosition: { ...citizen.previousPosition },
        homeBuildingId: citizen.homeBuildingId,
        workplaceBuildingId: citizen.workplaceBuildingId,
        activity: citizen.activity,
        activityTicksRemaining: citizen.activityTicksRemaining,
        route: citizen.route.map((position) => ({ ...position })),
        routeIndex: citizen.routeIndex,
      })),
    };
  };

  return {
    step(): void {
      const activitiesBefore = completedActivities;
      tick += 1;
      citizens.forEach(advanceCitizen);
      const activitiesCompletedThisTick = completedActivities - activitiesBefore;
      dataGeneratedThisTick = 0;
      if (activitiesCompletedThisTick > 0) {
        const { metrics } = calculateMetrics();
        dataGeneratedThisTick = roundData(activitiesCompletedThisTick * dataEfficiency(metrics));
        data = roundData(data + dataGeneratedThisTick);
      }
    },
    getSnapshot: snapshot,
    getDeterminismHash(): string {
      return stableHash(snapshot());
    },
  };
}
