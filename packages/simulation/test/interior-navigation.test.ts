import { describe, expect, it } from 'vitest';
import {
  createAStarSearch,
  createBuildingInstance,
  createBuildingPassabilityCallback,
  createBuildingTrip,
  decrementBuildingActivityTicks,
  movementCellKey,
  resolveMovementProposals,
  selectInternalBuildingDestinationCell,
  type BuildingActivitySnapshot,
  type BuildingArchetypeId,
  type MovementParticipant,
  type MovementProposal,
} from '../src/index';
import {
  createBuildingId,
  createCitizenId,
  createZoneId,
  type GridPosition,
} from '@idle-city/shared';

function completeBuilding(id: string, archetype: BuildingArchetypeId, origin: GridPosition) {
  return createBuildingInstance({
    id: createBuildingId(id),
    zoneId: createZoneId(`zone-for-${id}`),
    archetype,
    origin,
    state: { kind: 'complete' },
  });
}

function bounded(position: GridPosition): boolean {
  return position.x >= 0 && position.x <= 6 && position.y >= -1 && position.y <= 1;
}

describe('interior navigation', () => {
  it('enters the route destination footprint without crossing an unrelated building', () => {
    const target = completeBuilding('building-target', 'single-house', { x: 5, y: 0 });
    const unrelated = completeBuilding('building-unrelated', 'small-shop', { x: 2, y: -1 });
    const trip = createBuildingTrip({
      building: target,
      citizenId: createCitizenId('citizen-1'),
      worldSeed: 1234,
      tripSequence: 1,
    });
    const passability = createBuildingPassabilityCallback({
      buildings: [unrelated, target],
      destinationBuildingId: target.id,
    });
    const boundedWalkability = (position: GridPosition): boolean =>
      bounded(position) && passability(position);

    expect(passability(trip.destinationCell)).toBe(true);
    expect(passability({ x: 2, y: 0 })).toBe(false);

    const targetOnlyPassability = createBuildingPassabilityCallback({
      buildings: [target],
      destinationBuildingId: target.id,
    });
    const canEnterTarget = createAStarSearch({
      start: { x: 0, y: 0 },
      goal: trip.destinationCell,
      isWalkable: (position) => bounded(position) && targetOnlyPassability(position),
    }).advance(Number.MAX_SAFE_INTEGER);
    expect(canEnterTarget.status).toBe('found');

    const cannotCrossUnrelated = createAStarSearch({
      start: { x: 0, y: 0 },
      goal: trip.destinationCell,
      isWalkable: boundedWalkability,
    }).advance(Number.MAX_SAFE_INTEGER);
    expect(cannotCrossUnrelated.status).toBe('no-path');

    const incompleteTarget = createBuildingInstance({
      id: createBuildingId('building-incomplete-target'),
      zoneId: createZoneId('zone-incomplete-target'),
      archetype: 'single-house',
      origin: { x: 5, y: 0 },
      state: { kind: 'incomplete', laborCompleted: 0, laborRequired: 100 },
    });
    expect(
      createBuildingPassabilityCallback({
        buildings: [incompleteTarget],
        destinationBuildingId: incompleteTarget.id,
      })({ x: 5, y: 0 }),
    ).toBe(false);
    expect(
      createBuildingPassabilityCallback({
        buildings: [incompleteTarget],
        destinationBuildingId: incompleteTarget.id,
        isAuthorizedForIncompleteBuilding: () => true,
      })({ x: 5, y: 0 }),
    ).toBe(true);
  });

  it('keeps generic activity citizens on distinct footprint cells while timers advance', () => {
    const building = completeBuilding('building-activity', 'single-house', { x: 0, y: 0 });
    const citizenIds = [createCitizenId('citizen-a'), createCitizenId('citizen-b')];
    let participants: MovementParticipant[] = [
      {
        id: citizenIds[0],
        position: { x: 0, y: 0 },
        movementCredit: 1024,
        blockedMovementCount: 0,
        remainingRouteCells: 1,
        goalStartTick: 0,
      },
      {
        id: citizenIds[1],
        position: { x: 1, y: 0 },
        movementCredit: 1024,
        blockedMovementCount: 0,
        remainingRouteCells: 1,
        goalStartTick: 0,
      },
    ];
    let activities: BuildingActivitySnapshot[] = citizenIds.map(() => ({
      buildingId: building.id,
      kind: 'generic',
      ticksRemaining: 3,
      internalWanderingSequence: 0,
    }));

    for (let remainingTicks = 3; remainingTicks > 0; remainingTicks -= 1) {
      const occupancy = new Map(
        participants.map((participant) => [movementCellKey(participant.position), participant.id]),
      );
      const proposals: MovementProposal[] = [];
      for (let index = 0; index < participants.length; index += 1) {
        const participant = participants[index];
        const activity = activities[index];
        if (participant === undefined || activity === undefined) {
          throw new Error('Expected a participant and activity.');
        }
        const destination = selectInternalBuildingDestinationCell({
          worldSeed: 5678,
          citizenId: participant.id,
          buildingId: building.id,
          tripSequence: activity.internalWanderingSequence + 1,
          physicalCells: building.physicalCells,
        });
        const search = createAStarSearch({
          start: participant.position,
          goal: destination,
          isWalkable: (position) =>
            building.physicalCells.some((cell) => cell.x === position.x && cell.y === position.y),
        });
        const result = search.advance(Number.MAX_SAFE_INTEGER);
        const nextCell = result.path?.[0];
        if (result.status === 'found' && nextCell !== undefined) {
          proposals.push({
            citizenId: participant.id,
            from: participant.position,
            target: nextCell,
            kind: 'internal',
          });
        }
      }

      const resolution = resolveMovementProposals({
        seed: 5678,
        occupancy,
        participants,
        proposals,
        noProgressTicks: 0,
        isMoveLegal: (_participant, target) =>
          building.physicalCells.some((cell) => cell.x === target.x && cell.y === target.y),
      });
      const acceptedByCitizen = new Map(
        resolution.accepted.map((accepted) => [accepted.citizenId, accepted.target]),
      );
      participants = participants.map((participant) => ({
        ...participant,
        position: acceptedByCitizen.get(participant.id) ?? participant.position,
        movementCredit: acceptedByCitizen.has(participant.id)
          ? participant.movementCredit - 1024
          : participant.movementCredit,
      }));
      activities = activities.map((activity) => ({
        ...activity,
        ticksRemaining: decrementBuildingActivityTicks(activity.ticksRemaining),
        internalWanderingSequence: activity.internalWanderingSequence + 1,
      }));

      const occupied = new Set(
        participants.map((participant) => movementCellKey(participant.position)),
      );
      expect(occupied.size).toBe(participants.length);
      expect(
        participants.every((participant) =>
          building.physicalCells.some(
            (cell) => cell.x === participant.position.x && cell.y === participant.position.y,
          ),
        ),
      ).toBe(true);
    }

    expect(activities.every((activity) => activity.ticksRemaining === 0)).toBe(true);
  });
});
