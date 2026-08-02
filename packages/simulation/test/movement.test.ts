import { describe, expect, it } from 'vitest';
import {
  buildMovementProposals,
  compareMovementProposals,
  findDirectMovementSwapPairs,
  isMovementDeadlockRecoveryDue,
  isMovementReplanDue,
  replanMovementRoute,
  resolveMovementReservations,
  type MovementCandidate,
  type MovementProposal,
} from '../src/index';

interface Position {
  readonly x: number;
  readonly y: number;
}

const open = (): {
  isActive: (position: Position) => boolean;
  isWalkable: (position: Position) => boolean;
} => ({
  isActive: () => true,
  isWalkable: () => true,
});

function candidate(
  id: string,
  from: Position,
  to: Position,
  options: Partial<Pick<MovementCandidate, 'waitTicks' | 'tripStartedTick'>> = {},
): MovementCandidate {
  return {
    id,
    position: { ...from },
    route: [{ ...from }, { ...to }],
    routeIndex: 0,
    waitTicks: options.waitTicks ?? 0,
    tripStartedTick: options.tripStartedTick ?? 1,
  };
}

function resolve(
  candidates: readonly MovementCandidate[],
  emergencySwapPairs: ReadonlySet<string> = new Set(),
) {
  const proposals = buildMovementProposals({ candidates, ...open() });
  const occupancy = new Map(
    candidates.map((entry) => [
      `${String(entry.position.x)},${String(entry.position.y)}`,
      entry.id,
    ]),
  );
  return {
    proposals,
    resolution: resolveMovementReservations({
      proposals,
      movingOccupancy: occupancy,
      emergencySwapPairs,
    }),
  };
}

function acceptedIds(
  resolution: ReturnType<typeof resolveMovementReservations>,
): readonly string[] {
  return resolution.accepted.map(({ citizenId }) => citizenId).sort();
}

describe('deterministic next-cell reservations', () => {
  it('resolves two citizens proposing one target with the complete priority comparator', () => {
    const { resolution } = resolve([
      candidate('citizen-b', { x: 0, y: 1 }, { x: 0, y: 0 }),
      candidate('citizen-a', { x: 1, y: 0 }, { x: 0, y: 0 }),
    ]);
    expect(acceptedIds(resolution)).toEqual(['citizen-a']);
    expect(resolution.targetConflicts).toBe(1);
    expect(resolution.blocked).toMatchObject([
      { citizenId: 'citizen-b', reason: 'target-conflict' },
    ]);
  });

  it('handles three-way and four-way merges deterministically', () => {
    const three = resolve([
      candidate('citizen-c', { x: 0, y: 1 }, { x: 0, y: 0 }),
      candidate('citizen-a', { x: 1, y: 0 }, { x: 0, y: 0 }),
      candidate('citizen-b', { x: -1, y: 0 }, { x: 0, y: 0 }),
    ]);
    expect(acceptedIds(three.resolution)).toEqual(['citizen-a']);
    expect(three.resolution.targetConflicts).toBe(2);

    const four = resolve([
      candidate('citizen-d', { x: 0, y: -1 }, { x: 0, y: 0 }),
      candidate('citizen-c', { x: 0, y: 1 }, { x: 0, y: 0 }),
      candidate('citizen-b', { x: -1, y: 0 }, { x: 0, y: 0 }),
      candidate('citizen-a', { x: 1, y: 0 }, { x: 0, y: 0 }),
    ]);
    expect(acceptedIds(four.resolution)).toEqual(['citizen-a']);
    expect(four.resolution.targetConflicts).toBe(3);
  });

  it('permits a move into a cell vacated in the same commit', () => {
    const result = resolve([
      candidate('citizen-a', { x: 0, y: 0 }, { x: 1, y: 0 }),
      candidate('citizen-b', { x: 1, y: 0 }, { x: 2, y: 0 }),
    ]);
    expect(acceptedIds(result.resolution)).toEqual(['citizen-a', 'citizen-b']);
    expect(result.resolution.dependencyBlocks).toBe(0);
  });

  it('commits closed three-citizen and four-citizen rotations', () => {
    const threeProposals: MovementProposal[] = [
      {
        citizenId: 'citizen-a',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        waitTicks: 0,
        remainingRouteCells: 1,
        tripStartedTick: 1,
        valid: true,
      },
      {
        citizenId: 'citizen-b',
        from: { x: 1, y: 0 },
        to: { x: 1, y: 1 },
        waitTicks: 0,
        remainingRouteCells: 1,
        tripStartedTick: 1,
        valid: true,
      },
      {
        citizenId: 'citizen-c',
        from: { x: 1, y: 1 },
        to: { x: 0, y: 0 },
        waitTicks: 0,
        remainingRouteCells: 1,
        tripStartedTick: 1,
        valid: true,
      },
    ];
    const three = resolveMovementReservations({
      proposals: threeProposals,
      movingOccupancy: new Map([
        ['0,0', 'citizen-a'],
        ['1,0', 'citizen-b'],
        ['1,1', 'citizen-c'],
      ]),
    });
    expect(acceptedIds(three)).toEqual(['citizen-a', 'citizen-b', 'citizen-c']);
    expect(three.cyclesCommitted).toBe(1);
    expect(three.accepted.every(({ cycleLength }) => cycleLength === 3)).toBe(true);

    const four = resolve([
      candidate('citizen-a', { x: 0, y: 0 }, { x: 1, y: 0 }),
      candidate('citizen-b', { x: 1, y: 0 }, { x: 1, y: 1 }),
      candidate('citizen-c', { x: 1, y: 1 }, { x: 0, y: 1 }),
      candidate('citizen-d', { x: 0, y: 1 }, { x: 0, y: 0 }),
    ]);
    expect(acceptedIds(four.resolution)).toEqual([
      'citizen-a',
      'citizen-b',
      'citizen-c',
      'citizen-d',
    ]);
    expect(four.resolution.cyclesCommitted).toBe(1);
    expect(four.resolution.accepted.every(({ cycleLength }) => cycleLength === 4)).toBe(true);
  });

  it('rejects ordinary direct swaps and accepts exactly the emergency pair when enabled', () => {
    const candidates = [
      candidate('citizen-a', { x: 0, y: 0 }, { x: 1, y: 0 }),
      candidate('citizen-b', { x: 1, y: 0 }, { x: 0, y: 0 }),
    ];
    const ordinary = resolve(candidates);
    expect(ordinary.resolution.accepted).toEqual([]);
    expect(ordinary.resolution.ordinarySwapsRejected).toBe(1);
    expect(ordinary.resolution.blocked.map(({ reason }) => reason)).toEqual([
      'ordinary-swap',
      'ordinary-swap',
    ]);

    const emergency = resolve(candidates, new Set(['citizen-a|citizen-b']));
    expect(acceptedIds(emergency.resolution)).toEqual(['citizen-a', 'citizen-b']);
    expect(emergency.resolution.emergencySwaps).toBe(1);
  });

  it('allows one emergency swap on exactly the twelfth identical blocked tick', () => {
    const candidates = [
      candidate('citizen-a', { x: 0, y: 0 }, { x: 1, y: 0 }),
      candidate('citizen-b', { x: 1, y: 0 }, { x: 0, y: 0 }),
    ];
    const pairKey = 'citizen-a|citizen-b';
    let previousBlockedTicks = 0;
    let recoveryTick = 0;
    for (let tick = 1; tick <= 12; tick += 1) {
      const emergency = isMovementDeadlockRecoveryDue(previousBlockedTicks, true);
      const result = resolve(candidates, emergency ? new Set([pairKey]) : new Set());
      if (result.resolution.emergencySwaps > 0) {
        recoveryTick = tick;
        break;
      }
      previousBlockedTicks += 1;
    }
    expect(recoveryTick).toBe(12);
  });

  it('uses wait age, then route length, then trip start, then stable ID', () => {
    const base = {
      waitTicks: 0,
      remainingRouteCells: 3,
      tripStartedTick: 10,
      citizenId: 'citizen-z',
    };
    expect(
      compareMovementProposals(base, { ...base, citizenId: 'citizen-a', waitTicks: 1 }),
    ).toBeGreaterThan(0);
    expect(
      compareMovementProposals(
        { ...base, waitTicks: 1, remainingRouteCells: 9 },
        { ...base, waitTicks: 1, remainingRouteCells: 2 },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareMovementProposals(
        { ...base, waitTicks: 1, remainingRouteCells: 2, tripStartedTick: 12 },
        { ...base, waitTicks: 1, remainingRouteCells: 2, tripStartedTick: 10 },
      ),
    ).toBeGreaterThan(0);
    expect(compareMovementProposals(base, { ...base, citizenId: 'citizen-a' })).toBeGreaterThan(0);
  });

  it('finds direct swap pairs after target conflicts are ranked', () => {
    const proposals = buildMovementProposals({
      candidates: [
        candidate('citizen-b', { x: 0, y: 0 }, { x: 1, y: 0 }),
        candidate('citizen-a', { x: 1, y: 0 }, { x: 0, y: 0 }),
      ],
      ...open(),
    });
    expect(findDirectMovementSwapPairs(proposals).map(({ key }) => key)).toEqual([
      'citizen-a|citizen-b',
    ]);
  });

  it('does not depend on candidate storage order', () => {
    const candidates = [
      candidate('citizen-c', { x: 0, y: 1 }, { x: 0, y: 0 }),
      candidate('citizen-a', { x: 1, y: 0 }, { x: 0, y: 0 }, { waitTicks: 2 }),
      candidate('citizen-b', { x: -1, y: 0 }, { x: 0, y: 0 }, { tripStartedTick: 0 }),
    ];
    const left = resolve(candidates);
    const right = resolve([...candidates].reverse());
    expect(left).toEqual(right);
  });

  it('schedules the first replan at wait 8 and then every 8 additional waits', () => {
    expect(Array.from({ length: 7 }, (_, index) => isMovementReplanDue(index + 1))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(isMovementReplanDue(8)).toBe(true);
    expect(isMovementReplanDue(9)).toBe(false);
    expect(isMovementReplanDue(15)).toBe(false);
    expect(isMovementReplanDue(16)).toBe(true);
  });

  it('retains a route when a bounded replan has no alternate and uses adjacent cells when it succeeds', () => {
    const blockedRoute = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const failed = replanMovementRoute({
      chunkSize: 4,
      activeChunks: [{ x: 0, y: 0 }],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      currentRoute: blockedRoute,
      currentRouteIndex: 0,
      temporaryBlocked: new Set(['1,0']),
      isWalkable: (position) => position.y === 0 && position.x >= 0 && position.x <= 2,
      maxNodes: 100,
    });
    expect(failed.status).toBe('no-path');
    expect(failed.path).toEqual([]);
    expect(blockedRoute).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);

    const successful = replanMovementRoute({
      chunkSize: 4,
      activeChunks: [{ x: 0, y: 0 }],
      start: { x: 0, y: 1 },
      goal: { x: 2, y: 1 },
      currentRoute: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      currentRouteIndex: 0,
      temporaryBlocked: new Set(['1,1']),
      isWalkable: () => true,
      maxNodes: 100,
    });
    expect(successful.status).toBe('found');
    expect(successful.routeChanged).toBe(true);
    for (let index = 1; index < successful.path.length; index += 1) {
      const previous = successful.path[index - 1];
      const current = successful.path[index];
      if (previous === undefined || current === undefined) throw new Error('Path is sparse.');
      expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
      expect(`${String(current.x)},${String(current.y)}`).not.toBe('1,1');
    }
  });
});
