import { describe, expect, it } from 'vitest';
import { runBalance } from '../src/runner';

describe('balance runner', () => {
  it('returns deterministic JSON-ready summaries', () => {
    const first = runBalance({ seed: 1234, ticks: 1000 });
    const second = runBalance({ seed: 1234, ticks: 1000 });
    expect(first).toEqual(second);
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
    expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
  });
});
