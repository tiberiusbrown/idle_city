import { describe, expect, it } from 'vitest';
import { balanceScenarioNames, runBalance } from '../src/runner';

const requiredScenarios = [
  'empty-city-opening',
  'manual-data-opening',
  'distant-seed-construction',
  'unhoused-half-speed-construction',
  'housed-full-speed-construction',
  'first-home-work-transition',
  'four-worker-workplace',
  'blocked-building-side',
  'multi-access-service',
  'crossing-open-land',
  'builder-under-congestion',
  'overlapping-square-seeds',
] as const;

describe('balance runner Phase 2 fixtures', () => {
  it('exposes exactly the named deterministic scenarios', () => {
    expect([...balanceScenarioNames].sort()).toEqual([...requiredScenarios].sort());
  });

  it.each(requiredScenarios)('runs %s deterministically with invariants', (scenario) => {
    const first = runBalance({ seed: 2026, ticks: 40, scenario });
    const second = runBalance({ seed: 2026, ticks: 40, scenario });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.invariantFailures).toEqual([]);
    expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('keeps the default opening empty except for one unassigned citizen', () => {
    const summary = runBalance({ seed: 2026, ticks: 0, scenario: 'empty-city-opening' });
    expect(summary.buildingCount).toBe(0);
    expect(summary.constructionProjectsStarted).toBe(0);
    expect(summary.citizenCount).toBe(1);
    expect(summary.data).toBe(0);
    expect(summary.seeds).toEqual([]);
    expect(summary.assignments[0]).toMatchObject({
      homeBuildingId: null,
      workplaceBuildingId: null,
    });
  });

  it('executes manual Data actions in deterministic schedule order', () => {
    const summary = runBalance({ seed: 2026, ticks: 500, scenario: 'manual-data-opening' });
    const manualResults = summary.manualDataResults.map(({ result }) => result);
    expect(manualResults.slice(0, 22).every((result) => result.accepted)).toBe(true);
    expect(manualResults[22]).toEqual({ accepted: false, reason: 'unavailable' });
    expect(summary.commandResults.map(({ result }) => result.accepted)).toEqual([true, true]);
    expect(summary.seeds).toHaveLength(2);
    expect(summary.constructionProjectsCompleted).toBeGreaterThanOrEqual(2);
    expect(summary.completedWorkActivities).toBeGreaterThan(0);
    expect(summary.dataBySource.work).toBeGreaterThan(0);
    expect(summary.construction.laborUnits).toBeGreaterThan(0);
    expect(summary.invariantFailures).toEqual([]);
    expect(summary).toEqual(
      runBalance({ seed: 2026, ticks: 500, scenario: 'manual-data-opening' }),
    );
  });

  it('deep-clones scenario configs before callers mutate them', async () => {
    const { getBalanceScenarioConfig } = await import('../src/runner');
    const config = getBalanceScenarioConfig('housed-full-speed-construction') as {
      initialActiveRegion?: { width: number };
    };
    const initialActiveRegion = config.initialActiveRegion;
    if (initialActiveRegion === undefined) throw new Error('Initial region is required.');
    initialActiveRegion.width = 1;
    const initialBuildings = (config as { initialBuildings: { origin: { x: number } }[] })
      .initialBuildings;
    const firstBuilding = initialBuildings[0];
    if (firstBuilding === undefined) throw new Error('An initial building is required.');
    firstBuilding.origin.x = 999;
    const fresh = getBalanceScenarioConfig('housed-full-speed-construction');
    expect(fresh.initialActiveRegion?.width).toBeGreaterThan(1);
    expect(fresh.initialBuildings?.[0]?.origin.x).not.toBe(999);
  });

  it('reports real open-land construction and capacity fixtures', () => {
    const distant = runBalance({ seed: 2026, ticks: 180, scenario: 'distant-seed-construction' });
    expect(distant.invariantFailures).toEqual([]);
    expect(distant.constructionProjectsStarted).toBeGreaterThan(0);
    expect(distant.construction.laborUnits).toBeGreaterThan(0);

    const workers = runBalance({ seed: 2026, ticks: 180, scenario: 'four-worker-workplace' });
    expect(workers.citizenCount).toBe(4);
    expect(workers.invariantFailures).toEqual([]);
    expect(workers.completedWorkActivities).toBeGreaterThan(0);
    expect(workers.movement.committedMoves).toBeGreaterThan(0);
    expect(
      workers.assignments.every(
        ({ homeBuildingId, workplaceBuildingId }) => homeBuildingId && workplaceBuildingId,
      ),
    ).toBe(true);

    const half = runBalance({
      seed: 2026,
      ticks: 180,
      scenario: 'unhoused-half-speed-construction',
    });
    const full = runBalance({ seed: 2026, ticks: 180, scenario: 'housed-full-speed-construction' });
    expect(half.construction.laborUnits).toBeGreaterThan(0);
    expect(full.construction.laborUnits).toBeGreaterThan(0);
    expect(full.constructionProjectsCompleted).toBeGreaterThanOrEqual(
      half.constructionProjectsCompleted,
    );

    const transition = runBalance({
      seed: 2026,
      ticks: 500,
      scenario: 'first-home-work-transition',
    });
    expect(transition.constructionProjectsCompleted).toBeGreaterThan(0);
    expect(transition.dataBySource.work).toBeGreaterThan(0);
    expect(
      transition.assignments.some(
        ({ homeBuildingId, workplaceBuildingId }) => homeBuildingId && workplaceBuildingId,
      ),
    ).toBe(true);

    const overlap = runBalance({ seed: 2026, ticks: 0, scenario: 'overlapping-square-seeds' });
    expect(overlap.commandResults.every(({ result }) => result.accepted)).toBe(true);
    expect(overlap.seeds).toHaveLength(2);

    const blocked = runBalance({ seed: 2026, ticks: 180, scenario: 'blocked-building-side' });
    expect(blocked.completedTrips).toBeGreaterThan(0);
    expect(blocked.movement.committedMoves).toBeGreaterThan(0);
    expect(
      new Set(
        blocked.accessUsage
          .filter(({ buildingId }) => buildingId === 'workplace-1')
          .map(({ cell }) => `${String(cell.x)},${String(cell.y)}`),
      ).size,
    ).toBeGreaterThan(1);

    const crossing = runBalance({ seed: 2026, ticks: 180, scenario: 'crossing-open-land' });
    expect(crossing.movement.committedMoves).toBeGreaterThan(0);
    expect(crossing.completedTrips).toBeGreaterThan(0);
    expect(crossing.assignments).not.toEqual(
      runBalance({ seed: 2026, ticks: 180, scenario: 'four-worker-workplace' }).assignments,
    );

    const builder = runBalance({ seed: 2026, ticks: 180, scenario: 'builder-under-congestion' });
    expect(builder.constructionProjectsCompleted).toBeGreaterThan(0);
    expect(builder.construction.laborUnits).toBeGreaterThan(0);
    expect(builder.movement.committedMoves).toBeGreaterThan(0);

    const services = runBalance({ seed: 2026, ticks: 1200, scenario: 'multi-access-service' });
    expect(services.completedWorkActivities).toBeGreaterThanOrEqual(40);
    expect(services.corePurchaseResults[0]?.result).toMatchObject({ accepted: true });
    expect(services.serviceUses).toBeGreaterThan(0);
  }, 30_000);

  it('keeps long-running construction routes valid after topology changes', () => {
    const first = runBalance({ seed: 1234, ticks: 620, scenario: 'distant-seed-construction' });
    const second = runBalance({ seed: 1234, ticks: 620, scenario: 'distant-seed-construction' });
    expect(first.invariantFailures).toEqual([]);
    expect(first.constructionProjectsStarted).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  }, 30_000);
});
