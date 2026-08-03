import { describe, expect, it } from 'vitest';
import {
  canonicalTrafficEdge,
  createSimulation,
  createTrafficTelemetry,
  trafficEdgeKey,
  tryCanonicalTrafficEdge,
  type TrafficEdgeSnapshot,
} from '../src/index';

const left = { x: 0, y: 0 } as const;
const right = { x: 1, y: 0 } as const;

function totalTraffic(
  snapshot: ReturnType<ReturnType<typeof createSimulation>['getSnapshot']>,
): number {
  return snapshot.traffic.reduce((total, edge) => total + edge.total, 0);
}

const commuterFixture = {
  initialActiveRegion: { minX: 0, minY: 0, width: 4, height: 4 },
  initialBuildings: [
    { id: 'home-1', type: 'home' as const, origin: { x: 1, y: 1 } },
    { id: 'workplace-1', type: 'workplace' as const, origin: { x: 10, y: 1 } },
  ],
  initialCitizens: [
    { id: 'citizen-1', homeBuildingId: 'home-1', workplaceBuildingId: 'workplace-1' },
  ],
};

describe('deterministic traffic telemetry', () => {
  it('uses the exact default window and rejects unsafe test windows', () => {
    expect(createTrafficTelemetry().historyWindowTicks).toBe(256);
    expect(() => createTrafficTelemetry(0)).toThrow('positive safe integer');
    expect(() => createTrafficTelemetry(Number.POSITIVE_INFINITY)).toThrow('positive safe integer');
    expect(() => createSimulation({ citizenCount: 0, trafficHistoryWindowTicks: 0 })).toThrow(
      'trafficHistoryWindowTicks',
    );
  });

  it('canonicalizes one physical edge identically from either endpoint order', () => {
    const forward = canonicalTrafficEdge({ x: 4, y: 7 }, { x: 4, y: 8 });
    const reverse = canonicalTrafficEdge({ x: 4, y: 8 }, { x: 4, y: 7 });
    expect(reverse).toEqual(forward);
    expect(forward).toEqual({
      key: '4,7|4,8',
      a: { x: 4, y: 7 },
      b: { x: 4, y: 8 },
    });
    expect(trafficEdgeKey(forward.a, forward.b)).toBe(forward.key);
  });

  it('rejects invalid and non-adjacent edges without changing counters', () => {
    expect(() => canonicalTrafficEdge(left, { x: 2, y: 0 })).toThrow(
      'safe integer orthogonal neighbors',
    );
    expect(() => canonicalTrafficEdge(left, { x: 0.5, y: 0.5 })).toThrow(
      'safe integer orthogonal neighbors',
    );
    expect(tryCanonicalTrafficEdge(left, { x: 0, y: 2 })).toBeUndefined();

    const telemetry = createTrafficTelemetry(4);
    expect(() => telemetry.recordCommittedMove(left, { x: 2, y: 0 })).toThrow();
    expect(telemetry.getSnapshot()).toEqual([]);
    expect(telemetry.getCounters()).toEqual({
      activeEdges: 0,
      traversalEventsRecorded: 0,
      expiredTraversalEvents: 0,
      expiredBuckets: 0,
      peakActiveEdges: 0,
    });
  });

  it('records exact directional and total counts for committed moves', () => {
    const telemetry = createTrafficTelemetry(4);
    telemetry.advanceToTick(1);
    telemetry.recordCommittedMove(left, right);
    telemetry.recordCommittedMove(left, right);
    telemetry.recordCommittedMove(right, left);

    expect(telemetry.getSnapshot()).toEqual([
      {
        key: '0,0|1,0',
        a: { x: 0, y: 0 },
        b: { x: 1, y: 0 },
        aToB: 2,
        bToA: 1,
        total: 3,
      },
    ]);
    expect(telemetry.getCounters()).toMatchObject({
      activeEdges: 1,
      traversalEventsRecorded: 3,
      expiredTraversalEvents: 0,
      peakActiveEdges: 1,
    });
  });

  it('expires a traversal exactly after the configured window and removes empty edges', () => {
    const telemetry = createTrafficTelemetry({ historyWindowTicks: 3 });
    telemetry.advanceToTick(1);
    telemetry.recordCommittedMove(left, right);
    telemetry.advanceToTick(3);
    expect(telemetry.getSnapshot()[0]?.total).toBe(1);
    expect(telemetry.getCounters().expiredTraversalEvents).toBe(0);

    telemetry.advanceToTick(4);
    expect(telemetry.getSnapshot()).toEqual([]);
    expect(telemetry.getCounters()).toMatchObject({
      activeEdges: 0,
      traversalEventsRecorded: 1,
      expiredTraversalEvents: 1,
      expiredBuckets: 1,
    });
  });

  it('keeps newer traversals on an edge while expiring older bucket contributions', () => {
    const telemetry = createTrafficTelemetry(3);
    telemetry.advanceToTick(1);
    telemetry.recordCommittedMove(left, right);
    telemetry.advanceToTick(2);
    telemetry.recordCommittedMove(right, left);
    telemetry.advanceToTick(4);
    expect(telemetry.getSnapshot()).toMatchObject([{ key: '0,0|1,0', aToB: 0, bToA: 1, total: 1 }]);
    expect(telemetry.getCounters().expiredTraversalEvents).toBe(1);
    telemetry.advanceToTick(5);
    expect(telemetry.getSnapshot()).toEqual([]);
    expect(telemetry.getCounters().expiredTraversalEvents).toBe(2);
  });

  it('sorts traffic summaries by stable canonical key', () => {
    const telemetry = createTrafficTelemetry(8);
    telemetry.advanceToTick(1);
    telemetry.recordCommittedMove({ x: 2, y: 0 }, { x: 2, y: 1 });
    telemetry.recordCommittedMove({ x: 1, y: 0 }, { x: 0, y: 0 });
    expect(telemetry.getSnapshot().map(({ key }) => key)).toEqual(['0,0|1,0', '2,0|2,1']);
  });

  it('returns detached snapshots and repeated reads do not mutate history', () => {
    const telemetry = createTrafficTelemetry(8);
    telemetry.advanceToTick(1);
    telemetry.recordCommittedMove(left, right);
    const first = telemetry.getSnapshot();
    const before = JSON.stringify(first);
    const countersBefore = telemetry.getCounters();
    const firstEdge = first[0];
    if (firstEdge === undefined) throw new Error('A traffic edge is required.');
    (firstEdge.a as { x: number }).x = 99;
    (first as TrafficEdgeSnapshot[]).push(firstEdge);
    expect(JSON.stringify(telemetry.getSnapshot())).toBe(before);
    expect(telemetry.getCounters()).toEqual(countersBefore);
  });

  it('starts a new simulation with empty traffic history', () => {
    const simulation = createSimulation({ ...commuterFixture, activityDurationTicks: 1 });
    for (let tick = 0; tick < 30; tick += 1) simulation.step();
    expect(simulation.getSnapshot().traffic.length).toBeGreaterThan(0);

    const reset = createSimulation({ ...commuterFixture, activityDurationTicks: 1 });
    expect(reset.getSnapshot().traffic).toEqual([]);
    expect(reset.getSnapshot().structural.activeTrafficEdges).toBe(0);
  });

  it('keeps long-running history bounded to the configured window', () => {
    const historyWindowTicks = 8;
    const telemetry = createTrafficTelemetry(historyWindowTicks);
    for (let tick = 1; tick <= 2_000; tick += 1) {
      telemetry.advanceToTick(tick);
      telemetry.recordCommittedMove(left, right);
    }
    const snapshot = telemetry.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.total).toBe(historyWindowTicks);
    expect(telemetry.getCounters()).toMatchObject({
      activeEdges: 1,
      traversalEventsRecorded: 2_000,
      expiredTraversalEvents: 2_000 - historyWindowTicks,
      peakActiveEdges: 1,
    });
  });

  it('counts one committed simulation move once, not route planning or non-movement', () => {
    const simulation = createSimulation({
      ...commuterFixture,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1_000,
    });
    let sawRoutePlanningWithoutMovement = false;
    let sawCommittedMove = false;
    for (let tick = 0; tick < 100; tick += 1) {
      const before = simulation.getSnapshot();
      const beforeCitizen = before.citizens[0];
      if (beforeCitizen === undefined) throw new Error('A citizen is required.');
      simulation.step();
      const after = simulation.getSnapshot();
      const afterCitizen = after.citizens[0];
      if (afterCitizen === undefined) throw new Error('A citizen is required.');
      const moved =
        beforeCitizen.position.x !== afterCitizen.position.x ||
        beforeCitizen.position.y !== afterCitizen.position.y;
      if (beforeCitizen.route.length === 0 && afterCitizen.route.length > 1) {
        sawRoutePlanningWithoutMovement = true;
      }
      if (!moved) {
        expect(totalTraffic(after)).toBe(totalTraffic(before));
        expect(after.structural.trafficTraversalEventsRecorded).toBe(
          before.structural.trafficTraversalEventsRecorded,
        );
        continue;
      }
      if (totalTraffic(after) === totalTraffic(before)) continue;
      expect(totalTraffic(after)).toBe(totalTraffic(before) + 1);
      expect(after.structural.trafficTraversalEventsRecorded).toBe(
        before.structural.trafficTraversalEventsRecorded + 1,
      );
      expect(
        after.traffic.find(
          ({ key }) =>
            key === canonicalTrafficEdge(beforeCitizen.position, afterCitizen.position).key,
        )?.total,
      ).toBeGreaterThan(0);
      sawCommittedMove = true;
      break;
    }
    expect(sawRoutePlanningWithoutMovement).toBe(true);
    expect(sawCommittedMove).toBe(true);
  });
});
