import { describe, expect, it } from 'vitest';
import { balanceScenarioNames, runBalance } from '../src/runner';

describe('balance runner', () => {
  it('returns deterministic JSON-ready summaries', () => {
    const first = runBalance({ seed: 1234, ticks: 1000 });
    const second = runBalance({ seed: 1234, ticks: 1000 });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.scenario).toBe('baseline');
    expect(first.citizenCount).toBe(10);
    expect(first.completedTrips).toBeGreaterThan(0);
    expect(first.completedActivities).toBeGreaterThan(0);
    expect(first.data).toBeGreaterThan(0);
    expect(first.metrics.space).toBeGreaterThanOrEqual(0);
    expect(first.metrics.space).toBeLessThanOrEqual(1);
    expect(first.metrics.access).toBeGreaterThanOrEqual(0);
    expect(first.metrics.access).toBeLessThanOrEqual(1);
    expect(first.metrics.activity).toBeGreaterThanOrEqual(0);
    expect(first.metrics.activity).toBeLessThanOrEqual(1);
    expect(first.demandTotals.living).toBeGreaterThan(0);
    expect(first.demandTotals.working).toBeGreaterThan(0);
    expect(first.demandTotals.services).toBeGreaterThan(0);
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
  });

  it('schedules Living and Working seed commands and reports rejections', () => {
    for (const scenario of ['living-seed', 'working-seed'] as const) {
      const first = runBalance({ seed: 2026, ticks: 120, scenario });
      const second = runBalance({ seed: 2026, ticks: 120, scenario });
      expect(first).toEqual(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.commandResults).toHaveLength(2);
      expect(first.commandResults[0]?.result.accepted).toBe(true);
      expect(first.commandResults[1]?.result.accepted).toBe(false);
      expect(first.commandResults[1]?.result.reason).toMatch(/occupied|locked/);
      expect(first.determinismHash).toBe(second.determinismHash);
    }
  });

  it('reports greater access pressure for long commutes than a compact city', () => {
    const longCommute = runBalance({ seed: 7, ticks: 120, scenario: 'long-commute' });
    const compact = runBalance({ seed: 7, ticks: 120, scenario: 'compact' });
    expect(1 - longCommute.metrics.access).toBeGreaterThan(1 - compact.metrics.access);
    expect(longCommute.averageTripDurationTicks).toBeGreaterThan(compact.averageTripDurationTicks);
  });

  it('reports changed demand under capacity pressure', () => {
    const baseline = runBalance({ seed: 7, ticks: 0, scenario: 'baseline' });
    const pressure = runBalance({ seed: 7, ticks: 0, scenario: 'capacity-pressure' });
    expect(pressure.demandTotals.living).toBeGreaterThan(baseline.demandTotals.living);
    expect(pressure.demandTotals.working).toBeGreaterThan(baseline.demandTotals.working);
    expect(pressure.metrics.space).toBeLessThan(baseline.metrics.space);
  });
});
