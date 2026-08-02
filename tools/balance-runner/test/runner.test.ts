import { describe, expect, it } from 'vitest';
import { balanceScenarioNames, runBalance } from '../src/runner';

describe('balance runner', () => {
  it('returns deterministic JSON-ready summaries with structural counters', () => {
    const first = runBalance({ seed: 1234, ticks: 1000 });
    const second = runBalance({ seed: 1234, ticks: 1000 });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.scenario).toBe('baseline');
    expect(first.citizenCount).toBe(10);
    expect(first.completedTrips).toBeGreaterThan(0);
    expect(first.completedActivities).toBeGreaterThan(0);
    expect(first.data).toBeGreaterThan(0);
    expect(first.activeChunkCount).toBe(16);
    expect(first.structuralCounters.allocatedChunks).toBe(first.activeChunkCount);
    expect(first.structuralCounters.allocatedOccupancyBuffers).toBeGreaterThanOrEqual(1);
    expect(first.structuralCounters.allocatedDemandBuffers).toBe(first.activeChunkCount);
    expect(first.snapshotChunkSummaries).toBe(first.activeChunkCount);
    expect(first.invariantFailures).toEqual([]);
    expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('runs every named scenario deterministically with invariant reporting', () => {
    for (const scenario of balanceScenarioNames) {
      const first = runBalance({ seed: 2026, ticks: 120, scenario });
      const second = runBalance({ seed: 2026, ticks: 120, scenario });
      expect(first).toEqual(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.invariantFailures).toEqual([]);
      for (const value of Object.values(first.demandTotals)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  }, 30_000);

  it('schedules seed commands and reports final seed state plus rejections', () => {
    for (const scenario of ['living-seed', 'working-seed', 'rejected-command'] as const) {
      const first = runBalance({ seed: 2026, ticks: 120, scenario });
      const second = runBalance({ seed: 2026, ticks: 120, scenario });
      expect(first).toEqual(second);
      if (scenario === 'rejected-command') {
        expect(first.seeds).toEqual([]);
        expect(first.commandResults).toHaveLength(3);
        expect(first.commandResults.every(({ result }) => !result.accepted)).toBe(true);
      } else {
        expect(first.seeds).toHaveLength(1);
        expect(first.commandResults).toHaveLength(2);
        expect(first.commandResults[0]?.result.accepted).toBe(true);
        expect(first.commandResults[1]?.result.accepted).toBe(false);
        expect(first.commandResults[1]?.result.reason).toMatch(/occupied|locked/);
      }
    }
  }, 30_000);

  it('reports greater access pressure for long commutes than a compact city', () => {
    const longCommute = runBalance({ seed: 7, ticks: 120, scenario: 'long-commute' });
    const compact = runBalance({ seed: 7, ticks: 120, scenario: 'compact' });
    expect(1 - longCommute.metrics.access).toBeGreaterThan(1 - compact.metrics.access);
    expect(longCommute.averageTripDurationTicks).toBeGreaterThan(compact.averageTripDurationTicks);
  });

  it('reports sparse expansion and coordinate extent without a bounding-box allocation', () => {
    const sparse = runBalance({ seed: 7, ticks: 20, scenario: 'sparse-expansion' });
    const extent = runBalance({ seed: 7, ticks: 100, scenario: 'extent' });
    expect(sparse.activeChunkCount).toBe(7);
    expect(sparse.activationResults.every(({ result }) => result.accepted)).toBe(true);
    expect(extent.activeChunkCount).toBe(71);
    expect(extent.structuralCounters.allocatedDemandBuffers).toBe(71);
    expect(extent.activeChunkCount).toBeLessThan(71 * 71);
  });

  it('reports localized demand dirtying and a long multi-chunk route', () => {
    const localized = runBalance({ seed: 7, ticks: 0, scenario: 'localized-demand' });
    const route = runBalance({ seed: 7, ticks: 50, scenario: 'long-route' });
    expect(localized.invariantFailures).toEqual([]);
    expect(localized.structuralCounters.demandChunksDirtied).toBeGreaterThan(16);
    expect(route.structuralCounters.pathChunksTouched).toBeGreaterThan(1);
    expect(route.invariantFailures).toEqual([]);
  });

  it('reports changed demand under capacity pressure', () => {
    const baseline = runBalance({ seed: 7, ticks: 0, scenario: 'baseline' });
    const pressure = runBalance({ seed: 7, ticks: 0, scenario: 'capacity-pressure' });
    expect(pressure.demandTotals.living).toBeGreaterThan(baseline.demandTotals.living);
    expect(pressure.demandTotals.working).toBeGreaterThan(baseline.demandTotals.working);
    expect(pressure.metrics.space).toBeLessThan(baseline.metrics.space);
  });

  it('covers deterministic Step 4 development scenarios', () => {
    const scenarios = [
      'living-led',
      'working-led',
      'equal-score',
      'obstacle-constrained',
      'no-valid-footprint',
      'long-run-construction',
    ] as const;
    const summaries = new Map<(typeof scenarios)[number], ReturnType<typeof runBalance>>();
    for (const scenario of scenarios) {
      const first = runBalance({ seed: 2026, ticks: 120, scenario });
      const second = runBalance({ seed: 2026, ticks: 120, scenario });
      summaries.set(scenario, first);
      expect(first).toEqual(second);
      expect(first.invariantFailures).toEqual([]);
      expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(summaries.get('living-led')?.homeCount).toBeGreaterThan(1);
    expect(summaries.get('working-led')?.workplaceCount).toBeGreaterThan(1);
    expect(summaries.get('no-valid-footprint')?.constructionProjectsStarted).toBe(0);
    expect(summaries.get('long-run-construction')?.constructionProjectsCompleted).toBeGreaterThan(
      0,
    );
  });
});
