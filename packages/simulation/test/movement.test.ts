import { describe, expect, it } from 'vitest';
import {
  createCitizenId,
  createGridPosition,
  type CitizenId,
  type GridPosition,
} from '@idle-city/shared';
import {
  createSimulation,
  movementCellKey,
  resolveMovementProposals,
  type MovementParticipant,
  type MovementProposal,
} from '../src/index';

function completeOneTick(simulation: ReturnType<typeof createSimulation>): void {
  while (simulation.advanceTickWork(Number.MAX_SAFE_INTEGER).status !== 'committed') {
    // A large budget normally commits in one call; keep the helper correct if stages grow.
  }
}

function makeParticipant(
  id: string,
  position: GridPosition,
  blockedMovementCount = 0,
): MovementParticipant {
  return {
    id: createCitizenId(id),
    position,
    movementCredit: 1024,
    blockedMovementCount,
    remainingRouteCells: 1,
    goalStartTick: 0,
  };
}

function makeProposal(
  citizenId: CitizenId,
  from: GridPosition,
  target: GridPosition,
): MovementProposal {
  return { citizenId, from, target, kind: 'route' };
}

function resolveTestMovement(
  participants: readonly MovementParticipant[],
  proposals: readonly MovementProposal[],
) {
  const occupancy = new Map(
    participants.map((participant) => [movementCellKey(participant.position), participant.id]),
  );
  return resolveMovementProposals({
    seed: 1234,
    occupancy,
    participants,
    proposals,
    noProgressTicks: 0,
  });
}

describe('fixed-point wandering movement', () => {
  it('moves at half-cell speed no more often than every other tick and caps credit', () => {
    const simulation = createSimulation({ seed: 1234 });
    let lastMoveTick = 0;
    let movedAtLeastOnce = false;

    for (let tick = 1; tick <= 24; tick += 1) {
      completeOneTick(simulation);
      const citizen = simulation.getSnapshot().citizens[0];
      if (citizen === undefined) throw new Error('Expected the first citizen.');

      expect(citizen.movementCredit).toBeGreaterThanOrEqual(0);
      expect(citizen.movementCredit).toBeLessThanOrEqual(1024);

      const moved =
        citizen.position.x !== citizen.previousPosition.x ||
        citizen.position.y !== citizen.previousPosition.y;
      if (!moved) continue;

      movedAtLeastOnce = true;
      expect(tick - lastMoveTick).toBeGreaterThanOrEqual(2);
      lastMoveTick = tick;
    }

    expect(movedAtLeastOnce).toBe(true);
  });

  it('keeps four deterministic citizens distinct and inside each wandering anchor', () => {
    const simulation = createSimulation({ seed: 5678 });

    for (let tick = 0; tick < 24; tick += 1) {
      completeOneTick(simulation);
      const snapshot = simulation.getSnapshot();
      const occupied = new Set(
        snapshot.citizens.map(
          (citizen) => `${String(citizen.position.x)},${String(citizen.position.y)}`,
        ),
      );
      expect(occupied.size).toBe(4);

      for (const citizen of snapshot.citizens) {
        expect(
          Math.max(
            Math.abs(citizen.position.x - citizen.wanderingAnchor.x),
            Math.abs(citizen.position.y - citizen.wanderingAnchor.y),
          ),
        ).toBeLessThanOrEqual(16);
      }
    }
  });

  it('commits a legal two-citizen reverse-cell swap atomically', () => {
    const first = makeParticipant('citizen-a', createGridPosition(0, 0));
    const second = makeParticipant('citizen-b', createGridPosition(1, 0));
    const result = resolveTestMovement(
      [first, second],
      [
        makeProposal(first.id, first.position, second.position),
        makeProposal(second.id, second.position, first.position),
      ],
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted.map((move) => [move.citizenId, move.target])).toEqual([
      ['citizen-a', { x: 1, y: 0 }],
      ['citizen-b', { x: 0, y: 0 }],
    ]);
  });

  it('rotates a four-citizen occupancy cycle in one commit', () => {
    const citizens = [
      makeParticipant('citizen-a', createGridPosition(0, 0)),
      makeParticipant('citizen-b', createGridPosition(1, 0)),
      makeParticipant('citizen-c', createGridPosition(1, 1)),
      makeParticipant('citizen-d', createGridPosition(0, 1)),
    ];
    const result = resolveTestMovement(
      citizens,
      citizens.map((citizen, index) => {
        const target = citizens[(index + 1) % citizens.length];
        if (target === undefined) throw new Error('Expected a cycle target.');
        return makeProposal(citizen.id, citizen.position, target.position);
      }),
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(4);
  });

  it('resolves a blocked chain into its single escape cell', () => {
    const citizens = [
      makeParticipant('citizen-a', createGridPosition(0, 0)),
      makeParticipant('citizen-b', createGridPosition(1, 0)),
      makeParticipant('citizen-c', createGridPosition(2, 0)),
    ];
    const escapeCell = createGridPosition(3, 0);
    const result = resolveTestMovement(citizens, [
      makeProposal(citizens[0].id, citizens[0].position, citizens[1].position),
      makeProposal(citizens[1].id, citizens[1].position, citizens[2].position),
      makeProposal(citizens[2].id, citizens[2].position, escapeCell),
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.accepted.map((move) => move.target)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });
});
