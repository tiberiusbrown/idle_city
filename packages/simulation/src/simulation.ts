import { positionsEqual, stableHash, type GridPosition } from '@idle-city/shared';
import { findGridPath } from './pathfinding';
import { SeededRandom } from './random';
import type {
  Building,
  CitizenActivity,
  CitizenSnapshot,
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
  const random = new SeededRandom(seed);
  const homeBuilding: Building = {
    id: 'home-1',
    type: 'home',
    position: { x: 2, y: 2 },
    capacity: citizenCount,
  };
  const workplaceBuilding: Building = {
    id: 'workplace-1',
    type: 'workplace',
    position: { x: width - 3, y: height - 3 },
    capacity: citizenCount,
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
  }));
  let tick = 0;
  let completedTrips = 0;

  const buildingById = (id: string): Building => {
    const building = buildings.find((candidate) => candidate.id === id);
    if (building === undefined) throw new Error(`Citizen references missing building ${id}.`);
    return building;
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
  };

  const advanceCitizen = (citizen: CitizenState): void => {
    citizen.previousPosition = { ...citizen.position };
    if (citizen.activity === 'home' || citizen.activity === 'work') {
      citizen.activityTicksRemaining -= 1;
      if (citizen.activityTicksRemaining <= 0) {
        if (citizen.activity === 'home') {
          startTrip(citizen, 'commuting-to-work', citizen.workplaceBuildingId);
        } else {
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
      if (!positionsEqual(citizen.position, buildingById(destinationId).position)) {
        throw new Error(`Citizen ${citizen.id} did not reach the expected destination.`);
      }
      citizen.activity = citizen.activity === 'commuting-to-work' ? 'work' : 'home';
      citizen.activityTicksRemaining = activityDurationTicks;
      completedTrips += 1;
    }
  };

  const snapshot = (): SimulationSnapshot => ({
    width,
    height,
    seed,
    tick,
    randomState: random.getState(),
    completedTrips,
    buildings: buildings.map((building) => ({ ...building, position: { ...building.position } })),
    citizens: citizens.map((citizen): CitizenSnapshot => ({
      ...citizen,
      position: { ...citizen.position },
      previousPosition: { ...citizen.previousPosition },
      route: citizen.route.map((position) => ({ ...position })),
    })),
  });

  return {
    step(): void {
      tick += 1;
      citizens.forEach(advanceCitizen);
    },
    getSnapshot: snapshot,
    getDeterminismHash(): string {
      return stableHash(snapshot());
    },
  };
}
