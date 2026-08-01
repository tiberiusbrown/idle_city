import type { GridPosition } from '@idle-city/shared';
import type {
  Building,
  BuildingType,
  CityDemand,
  CityMetrics,
  DemandKind,
  DemandTotals,
} from './types';

export interface DemandCitizen {
  readonly homeBuildingId: string;
  readonly workplaceBuildingId: string;
}

/** A normalized additive influence supplied by authoritative district seeds. */
export type DemandSeedInfluence = (position: GridPosition, kind: DemandKind) => number;

export interface DemandCalculationInput {
  readonly width: number;
  readonly height: number;
  readonly buildings: readonly Building[];
  readonly citizens: readonly DemandCitizen[];
  readonly metrics: CityMetrics;
  readonly seedInfluence?: DemandSeedInfluence;
}

const demandKinds = ['living', 'working', 'services'] as const satisfies readonly DemandKind[];
const buildingTypes = ['home', 'workplace'] as const satisfies readonly BuildingType[];

function finite(name: string, value: number): number {
  if (!Number.isFinite(value))
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  return value;
}

function positiveInteger(name: string, value: number): number {
  finite(name, value);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer; received ${String(value)}.`);
  }
  return value;
}

function bounded(name: string, value: number): number {
  const checked = finite(name, value);
  if (checked < 0 || checked > 1) {
    throw new Error(`${name} must be between 0 and 1; received ${String(value)}.`);
  }
  return checked;
}

function clampUnit(name: string, value: number): number {
  const checked = finite(name, value);
  return Math.max(0, Math.min(1, checked));
}

function manhattanDistance(left: GridPosition, right: GridPosition): number {
  return finite('manhattan distance', Math.abs(left.x - right.x) + Math.abs(left.y - right.y));
}

function compareBuildings(left: Building, right: Building): number {
  const yDifference = left.position.y - right.position.y;
  if (yDifference !== 0) return yDifference;
  const xDifference = left.position.x - right.position.x;
  if (xDifference !== 0) return xDifference;
  const typeDifference = left.type < right.type ? -1 : left.type > right.type ? 1 : 0;
  if (typeDifference !== 0) return typeDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function comparePositions(left: GridPosition, right: GridPosition): number {
  const yDifference = left.y - right.y;
  return yDifference === 0 ? left.x - right.x : yDifference;
}

function validatePosition(
  name: string,
  position: GridPosition,
  width: number,
  height: number,
): void {
  finite(`${name}.x`, position.x);
  finite(`${name}.y`, position.y);
  if (
    !Number.isSafeInteger(position.x) ||
    !Number.isSafeInteger(position.y) ||
    position.x < 0 ||
    position.y < 0 ||
    position.x >= width ||
    position.y >= height
  ) {
    throw new Error(`${name} must be an in-bounds grid position.`);
  }
}

function totalCapacity(buildings: readonly Building[], type: BuildingType): number {
  return finite(
    `${type} capacity total`,
    buildings
      .filter((building) => building.type === type)
      .reduce(
        (total, building) => finite(`${type} capacity accumulation`, total + building.capacity),
        0,
      ),
  );
}

function normalizedShortage(population: number, capacity: number): number {
  const denominator = Math.max(1, population);
  return clampUnit('capacity shortage', (population - capacity) / denominator);
}

function nearestProximity(
  position: GridPosition,
  buildings: readonly Building[],
  maxDistance: number,
): number {
  let result = 0;
  for (const building of buildings) {
    const distance = manhattanDistance(position, building.position);
    const proximity = clampUnit('building proximity', 1 - distance / maxDistance);
    result = Math.max(result, proximity);
  }
  return bounded('nearest building proximity', result);
}

function buildingSaturation(building: Building, occupancy: ReadonlyMap<string, number>): number {
  const occupied = occupancy.get(building.id) ?? 0;
  if (building.capacity === 0) return occupied === 0 ? 0 : 1;
  return clampUnit('building saturation', occupied / building.capacity);
}

function localSaturation(
  position: GridPosition,
  type: BuildingType,
  buildings: readonly Building[],
  occupancy: ReadonlyMap<string, number>,
  maxDistance: number,
): number {
  let weightedSaturation = 0;
  let totalWeight = 0;
  for (const building of buildings) {
    if (building.type !== type) continue;
    const distance = manhattanDistance(position, building.position);
    const weight = clampUnit('saturation proximity', 1 - distance / maxDistance);
    const saturation = buildingSaturation(building, occupancy);
    weightedSaturation = finite(
      'weighted building saturation',
      weightedSaturation + weight * saturation,
    );
    totalWeight = finite('saturation weight total', totalWeight + weight);
  }
  if (totalWeight === 0) return 0;
  return clampUnit('local building saturation', weightedSaturation / totalWeight);
}

function normalizedInfluence(
  input: DemandCalculationInput,
  position: GridPosition,
  kind: DemandKind,
): number {
  if (input.seedInfluence === undefined) return 0;
  const influence = input.seedInfluence(position, kind);
  return finite(`seed influence for ${kind}`, influence);
}

function roundDemand(name: string, value: number): number {
  return clampUnit(name, Math.round(finite(name, value) * 1_000_000) / 1_000_000);
}

function buildOccupancy(
  citizens: readonly DemandCitizen[],
  buildingsById: ReadonlyMap<string, Building>,
  field: 'homeBuildingId' | 'workplaceBuildingId',
): Map<string, number> {
  const occupancy = new Map<string, number>();
  for (const citizen of citizens) {
    const buildingId = citizen[field];
    const building = buildingsById.get(buildingId);
    if (building === undefined) {
      throw new Error(`Citizen references missing building ${buildingId}.`);
    }
    const next = (occupancy.get(building.id) ?? 0) + 1;
    occupancy.set(building.id, finite('building occupancy', next));
  }
  return occupancy;
}

function addTotals(left: DemandTotals, right: DemandTotals): DemandTotals {
  return {
    living: finite('living demand total', left.living + right.living),
    working: finite('working demand total', left.working + right.working),
    services: finite('services demand total', left.services + right.services),
  };
}

export function calculateCityDemand(input: DemandCalculationInput): CityDemand {
  const width = positiveInteger('demand width', input.width);
  const height = positiveInteger('demand height', input.height);
  const population = finite('demand population', input.citizens.length);
  const metrics = {
    space: bounded('space metric', input.metrics.space),
    access: bounded('access metric', input.metrics.access),
    activity: bounded('activity metric', input.metrics.activity),
  } as const;
  const maxDistance = Math.max(1, width + height - 2);
  finite('demand maximum distance', maxDistance);

  const buildingsById = new Map<string, Building>();
  for (const [index, building] of input.buildings.entries()) {
    if (buildingsById.has(building.id)) throw new Error(`Duplicate building id ${building.id}.`);
    validatePosition(`building ${building.id}`, building.position, width, height);
    finite(`building ${building.id} capacity`, building.capacity);
    if (building.capacity < 0) {
      throw new Error(`Building ${building.id} capacity cannot be negative.`);
    }
    if (!buildingTypes.includes(building.type)) {
      throw new Error(`Building ${building.id} has an unsupported type.`);
    }
    buildingsById.set(building.id, building);
    finite(`building order ${String(index)}`, index);
  }
  const buildings = [...input.buildings].sort(compareBuildings);
  const homeBuildings = buildings.filter((building) => building.type === 'home');
  const workplaceBuildings = buildings.filter((building) => building.type === 'workplace');
  const homeOccupancy = buildOccupancy(input.citizens, buildingsById, 'homeBuildingId');
  const workplaceOccupancy = buildOccupancy(input.citizens, buildingsById, 'workplaceBuildingId');
  const housingShortage = normalizedShortage(population, totalCapacity(buildings, 'home'));
  const workplaceShortage = normalizedShortage(population, totalCapacity(buildings, 'workplace'));
  const accessPressure = clampUnit('access pressure', 1 - metrics.access);

  const positions: GridPosition[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) positions.push({ x, y });
  }
  positions.sort(comparePositions);

  let totals: DemandTotals = { living: 0, working: 0, services: 0 };
  const cells = positions.map(
    (
      position,
    ): {
      readonly position: GridPosition;
      readonly living: number;
      readonly working: number;
      readonly services: number;
    } => {
      const homeProximity = nearestProximity(position, homeBuildings, maxDistance);
      const workplaceProximity = nearestProximity(position, workplaceBuildings, maxDistance);
      const nearbyComplementaryUses = clampUnit(
        'nearby complementary uses',
        (homeProximity + workplaceProximity) / 2,
      );
      const travelPressure = clampUnit(
        'spatial travel pressure',
        accessPressure * (0.5 + 0.5 * (1 - nearbyComplementaryUses)),
      );
      const livingSaturation = localSaturation(
        position,
        'home',
        buildings,
        homeOccupancy,
        maxDistance,
      );
      const workingSaturation = localSaturation(
        position,
        'workplace',
        buildings,
        workplaceOccupancy,
        maxDistance,
      );
      const livingBase = finite(
        'living demand before influence',
        0.5 * housingShortage +
          0.25 * livingSaturation +
          0.1 * travelPressure +
          0.15 * workplaceProximity,
      );
      const workingBase = finite(
        'working demand before influence',
        0.5 * workplaceShortage +
          0.25 * workingSaturation +
          0.1 * travelPressure +
          0.15 * homeProximity,
      );
      const servicesBase = finite(
        'services demand before influence',
        0.55 * travelPressure + 0.45 * nearbyComplementaryUses,
      );
      const cell = {
        position: { ...position },
        living: roundDemand(
          'living demand',
          livingBase + normalizedInfluence(input, position, demandKinds[0]),
        ),
        working: roundDemand(
          'working demand',
          workingBase + normalizedInfluence(input, position, demandKinds[1]),
        ),
        services: roundDemand(
          'services demand',
          servicesBase + normalizedInfluence(input, position, demandKinds[2]),
        ),
      };
      totals = addTotals(totals, {
        living: cell.living,
        working: cell.working,
        services: cell.services,
      });
      return cell;
    },
  );

  return {
    cells,
    totals: {
      living: finite('living demand total', Math.round(totals.living * 1_000_000) / 1_000_000),
      working: finite('working demand total', Math.round(totals.working * 1_000_000) / 1_000_000),
      services: finite(
        'services demand total',
        Math.round(totals.services * 1_000_000) / 1_000_000,
      ),
    },
  };
}
