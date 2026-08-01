import type { ChunkCoordinate, GridPosition, GridRect } from '@idle-city/shared';
import { chunkKey, validateChunkSize } from './chunks';
import { isInsideFootprint } from './footprints';
import type {
  Building,
  BuildingType,
  CityDemand,
  CityMetrics,
  DemandCell,
  DemandChunkSnapshot,
  DemandKind,
  DemandTotals,
  LegacyCityDemand,
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

export interface DemandChunkCalculationInput {
  readonly chunk: ChunkCoordinate;
  readonly chunkSize: number;
  readonly buildings: readonly Building[];
  readonly citizens: readonly DemandCitizen[];
  readonly metrics: CityMetrics;
  readonly seedInfluence?: DemandSeedInfluence;
  readonly seedInfluenceRadius?: number;
  readonly revision?: number;
}

const demandKinds = ['living', 'working', 'services'] as const satisfies readonly DemandKind[];
const buildingTypes = ['home', 'workplace'] as const satisfies readonly BuildingType[];
const demandPrecision = 1_000_000;

interface PreparedDemand {
  readonly buildings: readonly Building[];
  readonly homeBuildings: readonly Building[];
  readonly workplaceBuildings: readonly Building[];
  readonly homeOccupancy: ReadonlyMap<string, number>;
  readonly workplaceOccupancy: ReadonlyMap<string, number>;
  readonly housingShortage: number;
  readonly workplaceShortage: number;
  readonly accessPressure: number;
  readonly maxDistance: number;
  readonly metrics: CityMetrics;
  readonly seedInfluence: DemandSeedInfluence | undefined;
}

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
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

function compareBuildings(left: Building, right: Building): number {
  const yDifference = left.footprint.y - right.footprint.y;
  if (yDifference !== 0) return yDifference;
  const xDifference = left.footprint.x - right.footprint.x;
  if (xDifference !== 0) return xDifference;
  const typeDifference = left.type < right.type ? -1 : left.type > right.type ? 1 : 0;
  if (typeDifference !== 0) return typeDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function distanceToRect(position: GridPosition, rect: GridRect): number {
  const dx =
    position.x < rect.x
      ? rect.x - position.x
      : position.x >= rect.x + rect.width
        ? position.x - (rect.x + rect.width - 1)
        : 0;
  const dy =
    position.y < rect.y
      ? rect.y - position.y
      : position.y >= rect.y + rect.height
        ? position.y - (rect.y + rect.height - 1)
        : 0;
  return finite('building footprint distance', dx + dy);
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
  return clampUnit('capacity shortage', (population - capacity) / Math.max(1, population));
}

function nearestProximity(
  position: GridPosition,
  buildings: readonly Building[],
  maxDistance: number,
): number {
  let result = 0;
  for (const building of buildings) {
    const distance = distanceToRect(position, building.footprint);
    result = Math.max(result, clampUnit('building proximity', 1 - distance / maxDistance));
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
    const distance = distanceToRect(position, building.footprint);
    const weight = clampUnit('saturation proximity', 1 - distance / maxDistance);
    weightedSaturation = finite(
      'weighted building saturation',
      weightedSaturation + weight * buildingSaturation(building, occupancy),
    );
    totalWeight = finite('saturation weight total', totalWeight + weight);
  }
  if (totalWeight === 0) return 0;
  return clampUnit('local building saturation', weightedSaturation / totalWeight);
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
    if (building === undefined)
      throw new Error(`Citizen references missing building ${buildingId}.`);
    occupancy.set(building.id, (occupancy.get(building.id) ?? 0) + 1);
  }
  return occupancy;
}

function prepareDemand(
  buildingsInput: readonly Building[],
  citizens: readonly DemandCitizen[],
  metricsInput: CityMetrics,
  maxDistance: number,
  seedInfluence: DemandSeedInfluence | undefined,
): PreparedDemand {
  const metrics = {
    space: bounded('space metric', metricsInput.space),
    access: bounded('access metric', metricsInput.access),
    activity: bounded('activity metric', metricsInput.activity),
  } as const;
  const buildingsById = new Map<string, Building>();
  for (const building of buildingsInput) {
    if (buildingsById.has(building.id)) throw new Error(`Duplicate building id ${building.id}.`);
    if (!buildingTypes.includes(building.type)) {
      throw new Error(`Building ${building.id} has an unsupported type.`);
    }
    if (!Number.isFinite(building.capacity) || building.capacity < 0) {
      throw new Error(`Building ${building.id} capacity cannot be negative.`);
    }
    if (isInsideFootprint(building.entrance, building.footprint)) {
      // The public building invariant is checked by the simulation; this
      // guard keeps the pure demand helper from silently using bad geometry.
      throw new Error(`Building ${building.id} entrance is inside its footprint.`);
    }
    buildingsById.set(building.id, building);
  }
  const buildings = [...buildingsInput].sort(compareBuildings);
  return {
    buildings,
    homeBuildings: buildings.filter((building) => building.type === 'home'),
    workplaceBuildings: buildings.filter((building) => building.type === 'workplace'),
    homeOccupancy: buildOccupancy(citizens, buildingsById, 'homeBuildingId'),
    workplaceOccupancy: buildOccupancy(citizens, buildingsById, 'workplaceBuildingId'),
    housingShortage: normalizedShortage(citizens.length, totalCapacity(buildings, 'home')),
    workplaceShortage: normalizedShortage(citizens.length, totalCapacity(buildings, 'workplace')),
    accessPressure: clampUnit('access pressure', 1 - metrics.access),
    maxDistance: positiveInteger('demand maximum distance', Math.ceil(maxDistance)),
    metrics,
    seedInfluence,
  };
}

function roundDemand(name: string, value: number): number {
  return clampUnit(name, Math.round(finite(name, value) * demandPrecision) / demandPrecision);
}

function demandCell(position: GridPosition, prepared: PreparedDemand): DemandCell {
  const homeProximity = nearestProximity(position, prepared.homeBuildings, prepared.maxDistance);
  const workplaceProximity = nearestProximity(
    position,
    prepared.workplaceBuildings,
    prepared.maxDistance,
  );
  const nearbyComplementaryUses = clampUnit(
    'nearby complementary uses',
    (homeProximity + workplaceProximity) / 2,
  );
  const travelPressure = clampUnit(
    'spatial travel pressure',
    prepared.accessPressure * (0.5 + 0.5 * (1 - nearbyComplementaryUses)),
  );
  const livingBase = finite(
    'living demand before influence',
    0.5 * prepared.housingShortage +
      0.25 *
        localSaturation(
          position,
          'home',
          prepared.buildings,
          prepared.homeOccupancy,
          prepared.maxDistance,
        ) +
      0.1 * travelPressure +
      0.15 * workplaceProximity,
  );
  const workingBase = finite(
    'working demand before influence',
    0.5 * prepared.workplaceShortage +
      0.25 *
        localSaturation(
          position,
          'workplace',
          prepared.buildings,
          prepared.workplaceOccupancy,
          prepared.maxDistance,
        ) +
      0.1 * travelPressure +
      0.15 * homeProximity,
  );
  const servicesBase = finite(
    'services demand before influence',
    0.55 * travelPressure + 0.45 * nearbyComplementaryUses,
  );
  const influence = (kind: DemandKind): number => {
    if (prepared.seedInfluence === undefined) return 0;
    return finite(`seed influence for ${kind}`, prepared.seedInfluence(position, kind));
  };
  return {
    position: { ...position },
    living: roundDemand('living demand', livingBase + influence(demandKinds[0])),
    working: roundDemand('working demand', workingBase + influence(demandKinds[1])),
    services: roundDemand('services demand', servicesBase + influence(demandKinds[2])),
  };
}

function addTotals(left: DemandTotals, right: DemandTotals): DemandTotals {
  return {
    living: finite('living demand total', left.living + right.living),
    working: finite('working demand total', left.working + right.working),
    services: finite('services demand total', left.services + right.services),
  };
}

function summarizeTotals(totals: DemandTotals): DemandTotals {
  return {
    living: Math.round(totals.living * demandPrecision) / demandPrecision,
    working: Math.round(totals.working * demandPrecision) / demandPrecision,
    services: Math.round(totals.services * demandPrecision) / demandPrecision,
  };
}

function cellsTotals(cells: readonly DemandCell[]): DemandTotals {
  let totals: DemandTotals = { living: 0, working: 0, services: 0 };
  for (const cell of cells) {
    totals = addTotals(totals, {
      living: cell.living,
      working: cell.working,
      services: cell.services,
    });
  }
  return summarizeTotals(totals);
}

export function calculateDemandChunk(input: DemandChunkCalculationInput): DemandChunkSnapshot {
  const chunkSize = validateChunkSize(input.chunkSize);
  if (!Number.isSafeInteger(input.chunk.x) || !Number.isSafeInteger(input.chunk.y)) {
    throw new Error('Demand chunks require safe integer coordinates.');
  }
  const maxDistance = input.seedInfluenceRadius ?? chunkSize * 4;
  positiveInteger('seed influence radius', Math.ceil(maxDistance));
  const prepared = prepareDemand(
    input.buildings,
    input.citizens,
    input.metrics,
    maxDistance,
    input.seedInfluence,
  );
  const origin = { x: input.chunk.x * chunkSize, y: input.chunk.y * chunkSize };
  const cells: DemandCell[] = [];
  for (let y = origin.y; y < origin.y + chunkSize; y += 1) {
    for (let x = origin.x; x < origin.x + chunkSize; x += 1) {
      cells.push(demandCell({ x, y }, prepared));
    }
  }
  const revision = input.revision ?? 1;
  positiveInteger('demand revision', revision);
  return {
    chunk: { ...input.chunk },
    key: chunkKey(input.chunk),
    revision,
    cellCount: cells.length,
    totals: cellsTotals(cells),
    cells,
  };
}

/**
 * Standalone bounded-grid helper retained for analysis tools. The simulation
 * itself uses calculateDemandChunk and never places these cells in its normal
 * snapshot.
 */
export function calculateCityDemand(input: DemandCalculationInput): LegacyCityDemand {
  const width = positiveInteger('demand width', input.width);
  const height = positiveInteger('demand height', input.height);
  const prepared = prepareDemand(
    input.buildings,
    input.citizens,
    input.metrics,
    Math.max(1, width + height - 2),
    input.seedInfluence,
  );
  const cells: DemandCell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) cells.push(demandCell({ x, y }, prepared));
  }
  return { cells, totals: cellsTotals(cells) };
}

export type { CityDemand };
