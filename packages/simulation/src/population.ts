import { squareDistance } from '@idle-city/shared';
import type { GridPosition } from '@idle-city/shared';
import type { Building } from './types';

export interface PopulationAssignment {
  readonly home: Building;
  readonly workplace: Building;
  readonly distance: number;
}

export interface PopulationAssignmentInput {
  readonly buildings: readonly Building[];
  readonly occupancy: ReadonlyMap<string, number>;
  /** Optional deterministic validity check for the selected pair. */
  readonly canUsePair?: (home: Building, workplace: Building) => boolean;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function distance(left: GridPosition, right: GridPosition): number {
  return squareDistance(left, right);
}

function compareAssignments(left: PopulationAssignment, right: PopulationAssignment): number {
  if (left.distance !== right.distance) return left.distance - right.distance;
  const homeOrder = compareIds(left.home.id, right.home.id);
  if (homeOrder !== 0) return homeOrder;
  return compareIds(left.workplace.id, right.workplace.id);
}

/**
 * Selects the nearest reachable home/workplace pair with free capacity.
 * Building IDs are the final tie-breaker, so array order cannot affect growth.
 */
export function findNearestCompatiblePair(
  input: PopulationAssignmentInput,
): PopulationAssignment | undefined {
  const homes = input.buildings
    .filter((building) => {
      const occupied = input.occupancy.get(building.id) ?? 0;
      return building.type === 'home' && occupied < building.capacity;
    })
    .sort((left, right) => compareIds(left.id, right.id));
  const workplaces = input.buildings
    .filter((building) => {
      const occupied = input.occupancy.get(building.id) ?? 0;
      return building.type === 'workplace' && occupied < building.capacity;
    })
    .sort((left, right) => compareIds(left.id, right.id));

  const candidates: PopulationAssignment[] = [];
  for (const home of homes) {
    for (const workplace of workplaces) {
      candidates.push({
        home,
        workplace,
        distance: distance(home.entrance, workplace.entrance),
      });
    }
  }
  candidates.sort(compareAssignments);
  for (const candidate of candidates) {
    if (input.canUsePair === undefined || input.canUsePair(candidate.home, candidate.workplace)) {
      return candidate;
    }
  }
  return undefined;
}
