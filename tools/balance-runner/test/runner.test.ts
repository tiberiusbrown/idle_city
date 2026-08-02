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
    expect(localized.structuralCounters.demandChunksDirtied).toBeGreaterThanOrEqual(16);
    expect(route.structuralCounters.pathChunksTouched).toBeGreaterThan(1);
    expect(route.invariantFailures).toEqual([]);
  });

  it('reports deterministic internal traffic for the required movement scenarios', () => {
    const scenarios = [
      'one-commuter',
      'two-opposite-direction-commuters',
      'shared-corridor',
      'narrow-passage',
      'multi-chunk-commute',
      'long-running-repeated-commute',
    ] as const;
    const summaries = new Map<(typeof scenarios)[number], ReturnType<typeof runBalance>>();
    for (const scenario of scenarios) {
      const first = runBalance({ seed: 2026, ticks: 180, scenario });
      const second = runBalance({ seed: 2026, ticks: 180, scenario });
      summaries.set(scenario, first);
      expect(first).toEqual(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.invariantFailures).toEqual([]);
      expect(first.trafficTraversalEventsRecorded).toBeGreaterThan(0);
      expect(first.activeTrafficEdges).toBe(first.traffic.length);
      expect(first.directionalTraversals).toBe(first.totalTraversals);
      expect(first.trafficTraversalEventsRecorded).toBe(
        first.totalTraversals + first.expiredTraversalEvents,
      );
      expect(first.peakActiveEdges).toBeGreaterThanOrEqual(first.activeTrafficEdges);
      expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(
      summaries
        .get('two-opposite-direction-commuters')
        ?.traffic.some(({ aToB, bToA }) => aToB > 0 && bToA > 0),
    ).toBe(true);
    expect(summaries.get('shared-corridor')?.totalTraversals).toBeGreaterThan(
      summaries.get('one-commuter')?.totalTraversals ?? 0,
    );
    expect(summaries.get('multi-chunk-commute')?.activeTrafficEdges).toBeGreaterThan(
      summaries.get('narrow-passage')?.activeTrafficEdges ?? 0,
    );
  }, 30_000);

  it('reports occupancy-aware housing and workplace surplus scenarios', () => {
    const housingSurplus = runBalance({ seed: 7, ticks: 30, scenario: 'housing-surplus' });
    const workplaceSurplus = runBalance({ seed: 7, ticks: 30, scenario: 'workplace-surplus' });
    expect(housingSurplus.invariantFailures).toEqual([]);
    expect(workplaceSurplus.invariantFailures).toEqual([]);
    expect(housingSurplus.citizenCount).toBe(1);
    expect(workplaceSurplus.citizenCount).toBe(1);
    expect(housingSurplus.demandTotals.living).toBeLessThan(workplaceSurplus.demandTotals.living);
    expect(housingSurplus.demandTotals.working).toBeGreaterThan(
      workplaceSurplus.demandTotals.working,
    );
  });

  it('reports Step 9 movement scenarios with deterministic wait and conflict metrics', () => {
    const scenarios = [
      'crossing-flows',
      'narrow-shared-corridor',
      'entrance-bottleneck',
      'two-way-corridor',
      'dense-commute',
      'multi-chunk-merge',
    ] as const;
    for (const scenario of scenarios) {
      const first = runBalance({ seed: 2026, ticks: 120, scenario });
      const second = runBalance({ seed: 2026, ticks: 120, scenario });
      expect(first).toEqual(second);
      expect(first.invariantFailures).toEqual([]);
      expect(first.movement.proposals).toBe(
        first.movement.committedMoves + first.movement.blockedMoves,
      );
      expect(first.movement.averageWaitTicks).toBeGreaterThanOrEqual(0);
      expect(first.movement.maxWaitTicks).toBeGreaterThanOrEqual(first.movement.averageWaitTicks);
      expect(first.trafficTraversalEventsRecorded).toBe(first.movement.committedMoves);
      expect(first.completedTrips).toBeGreaterThan(0);
      expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
    }
  }, 30_000);

  it('covers balanced, tied, capped, and long-run population scenarios', () => {
    const balanced = runBalance({ seed: 7, ticks: 30, scenario: 'balanced-expansion' });
    const tie = runBalance({ seed: 7, ticks: 30, scenario: 'tie' });
    const capped = runBalance({ seed: 7, ticks: 30, scenario: 'capped-growth' });
    const longRun = runBalance({ seed: 7, ticks: 120, scenario: 'long-run-city' });
    expect(balanced.citizenCount).toBe(balanced.populationCap);
    expect(capped.citizenCount).toBe(capped.populationCap);
    expect(tie.completedTrips).toBeGreaterThan(0);
    expect(longRun.completedActivities).toBeGreaterThan(0);
    for (const summary of [balanced, tie, capped, longRun]) {
      expect(summary.invariantFailures).toEqual([]);
      expect(summary.determinismHash).toMatch(/^[0-9a-f]{8}$/);
    }
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

  it('covers Step 9.5 seed, circulation, and incremental-development scenarios', () => {
    const scenarios = [
      'seed-boundary',
      'multiple-same-type-seeds',
      'sparse-development',
      'two-connected-row-buildings',
      'narrow-connector',
      'dense-circulation',
      'development-supersession',
      'long-incremental-development',
      'step9-dense-movement',
    ] as const;
    const summaries = new Map<(typeof scenarios)[number], ReturnType<typeof runBalance>>();
    for (const scenario of scenarios) {
      const first = runBalance({ seed: 2026, ticks: 120, scenario });
      const second = runBalance({ seed: 2026, ticks: 120, scenario });
      summaries.set(scenario, first);
      expect(first).toEqual(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.invariantFailures).toEqual([]);
      expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
      expect(first.structuralCounters.developmentPeakAnchorChecksPerTick).toBeLessThanOrEqual(512);
      expect(
        first.structuralCounters.developmentPeakFinalistValidationsPerTick,
      ).toBeLessThanOrEqual(4);
      expect(first.structuralCounters.developmentPeakCorridorExpansionsPerTick).toBeLessThanOrEqual(
        2_048,
      );
    }
    expect(summaries.get('seed-boundary')?.commandResults[0]?.preview.radius).toBe(10);
    expect(
      summaries.get('seed-boundary')?.commandResults[0]?.preview.activeCoveredCellCount,
    ).toBeLessThan(
      summaries.get('seed-boundary')?.commandResults[0]?.preview.coveredCellCount ?? 0,
    );
    expect(
      summaries
        .get('multiple-same-type-seeds')
        ?.commandResults.map(({ result }) => result.accepted && result.cost),
    ).toEqual([10, 13]);
    expect(
      summaries.get('sparse-development')?.structuralCounters.developmentPeakAnchorChecksPerTick,
    ).toBe(512);
    expect(
      summaries.get('two-connected-row-buildings')?.structuralCounters.rightOfWayCellsAdded,
    ).toBeGreaterThan(0);
    expect(
      summaries.get('two-connected-row-buildings')?.constructionProjectsStarted,
    ).toBeGreaterThan(0);
    expect(summaries.get('narrow-connector')?.constructionProjectsStarted).toBe(0);
    expect(
      summaries.get('development-supersession')?.structuralCounters.developmentJobsSuperseded,
    ).toBeGreaterThan(0);
    expect(
      summaries.get('long-incremental-development')?.structuralCounters.developmentJobsStarted,
    ).toBeGreaterThan(0);
    expect(summaries.get('step9-dense-movement')?.movement.proposals).toBeGreaterThan(0);
  }, 30_000);

  it('covers Step 9.6 labor, staging, pause, commute, and renderer-scale scenarios', () => {
    const scenarios = [
      'one-worker-slow-build',
      'full-staff-build',
      'workers-competing-one-corridor',
      'staging-cell-queue',
      'worker-blocked-replans',
      'no-eligible-workers',
      'phase-cap-decrease',
      'construction-dense-commute',
      'off-screen-construction',
      'repeated-deterministic-construction',
    ] as const;
    const summaries = new Map<(typeof scenarios)[number], ReturnType<typeof runBalance>>();
    for (const scenario of scenarios) {
      const ticks = scenario === 'phase-cap-decrease' ? 240 : 120;
      const first = runBalance({ seed: 2026, ticks, scenario });
      const second = runBalance({ seed: 2026, ticks, scenario });
      summaries.set(scenario, first);
      expect(first).toEqual(second);
      expect(first.invariantFailures).toEqual([]);
      expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(summaries.get('one-worker-slow-build')?.construction.laborUnits).toBeGreaterThan(0);
    expect(summaries.get('full-staff-build')?.construction.workerArrivals).toBeGreaterThan(0);
    expect(
      summaries.get('workers-competing-one-corridor')?.movement.replansAttempted,
    ).toBeGreaterThan(0);
    expect(summaries.get('staging-cell-queue')?.construction.assignmentsAccepted).toBeGreaterThan(
      0,
    );
    expect(summaries.get('worker-blocked-replans')?.movement.replansSucceeded).toBeGreaterThan(0);
    expect(summaries.get('no-eligible-workers')?.construction.laborUnits).toBe(0);
    expect(summaries.get('no-eligible-workers')?.construction.pausedProjectTicks).toBeGreaterThan(
      0,
    );
    expect(summaries.get('phase-cap-decrease')?.construction.workerReleases).toBeGreaterThan(0);
    expect(
      summaries.get('construction-dense-commute')?.construction.constructionCommutes,
    ).toBeGreaterThan(0);
    expect(summaries.get('off-screen-construction')?.construction.laborUnits).toBeGreaterThan(0);
  }, 30_000);

  it('covers the Services Core progression and generic Services scenarios', () => {
    const scenarios = [
      'services-core-progression',
      'no-service-shortage',
      'one-service-near-homes',
      'one-service-near-workplaces',
      'competing-services',
      'service-capacity-bottleneck',
      'services-seed-development',
      'dense-service-commute',
    ] as const;
    const summaries = new Map<(typeof scenarios)[number], ReturnType<typeof runBalance>>();
    for (const scenario of scenarios) {
      const ticks = scenario === 'dense-service-commute' ? 2_200 : 1_400;
      const summary = runBalance({ seed: 2026, ticks, scenario });
      summaries.set(scenario, summary);
      expect(summary.invariantFailures).toEqual([]);
      expect(summary.determinismHash).toMatch(/^[0-9a-f]{8}$/);
      expect(summary.corePurchaseResults).toHaveLength(1);
      expect(summary.corePurchaseResults[0]?.result).toEqual({
        accepted: true,
        core: 'services',
        focus: 'activity',
        cost: 50,
      });
      expect(summary.servicesCore.purchased).toBe(true);
      expect(summary.researchFocus).toBe('activity');
      expect(summary.completedActivities).toBe(
        summary.completedWorkActivities + summary.completedServiceActivities,
      );
      expect(summary.dataBySource.work).toBeGreaterThan(0);
    }

    const noShortage = summaries.get('no-service-shortage');
    expect(noShortage?.serviceCount).toBe(0);
    expect(noShortage?.serviceUses).toBe(0);
    expect(noShortage?.failedServiceDestinationAttempts).toBeGreaterThan(0);

    for (const scenario of [
      'one-service-near-homes',
      'one-service-near-workplaces',
      'competing-services',
      'service-capacity-bottleneck',
    ] as const) {
      const summary = summaries.get(scenario);
      expect(
        summary?.commandResults.some(
          ({ command, result }) => command.kind === 'services' && result.accepted,
        ),
      ).toBe(true);
      expect(summary?.serviceCount).toBeGreaterThan(0);
      if (scenario !== 'one-service-near-workplaces') {
        expect(summary?.serviceUses).toBeGreaterThan(0);
        expect(summary?.dataBySource.service).toBeGreaterThan(0);
      }
    }

    const bottleneck = summaries.get('service-capacity-bottleneck');
    expect(bottleneck?.failedServiceDestinationAttempts).toBeGreaterThan(0);
    expect(bottleneck?.serviceWaitTicks).toBeGreaterThan(0);

    for (const scenario of ['services-seed-development', 'dense-service-commute'] as const) {
      const first = runBalance({
        seed: 2026,
        ticks: 2_200,
        scenario,
      });
      const second = runBalance({
        seed: 2026,
        ticks: 2_200,
        scenario,
      });
      expect(first).toEqual(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.constructionProjectsStarted).toBeGreaterThan(0);
      expect(first.serviceUses).toBeGreaterThan(0);
    }
  }, 120_000);

  it('covers the Step 10.5 route, recovery, starvation, and square-seed scenarios', () => {
    const movementScenarios = [
      'two-lane-equal-cost-corridor',
      'crossing-four-route-profiles',
      'dense-home-work-commute',
    ] as const;
    for (const scenario of movementScenarios) {
      const first = runBalance({ seed: 2026, ticks: 180, scenario });
      const second = runBalance({ seed: 2026, ticks: 180, scenario });
      expect(first).toEqual(second);
      expect(first.invariantFailures).toEqual([]);
      expect(first.movement.proposals).toBeGreaterThan(0);
      expect(first.movement.replansAttempted).toBeGreaterThan(0);
      expect(first.movement.replansUnchanged).toBeGreaterThanOrEqual(0);
      expect(first.movement.criticalPriorityWins).toBeGreaterThanOrEqual(0);
    }

    const builder = runBalance({ seed: 2026, ticks: 120, scenario: 'builder-queued-corridor' });
    const starvation = runBalance({ seed: 2026, ticks: 120, scenario: 'labor-starvation-11-12' });
    const noEligible = runBalance({ seed: 2026, ticks: 120, scenario: 'no-eligible-workers' });
    expect(builder.invariantFailures).toEqual([]);
    expect(builder.construction.criticalPromotions).toBeGreaterThan(0);
    expect(builder.construction.criticalConflictWins).toBeGreaterThanOrEqual(0);
    expect(starvation.construction.criticalPromotions).toBeGreaterThan(0);
    expect(starvation.construction.criticalNoEligibleWorkerTicks).toBe(0);
    expect(noEligible.construction.criticalPromotions).toBe(0);
    expect(noEligible.construction.criticalNoEligibleWorkerTicks).toBeGreaterThan(0);

    for (const scenario of [
      'square-seed-straightaway',
      'square-seed-row-corridor',
      'overlapping-square-seeds',
      'square-seed-boundary',
    ] as const) {
      const first = runBalance({ seed: 2026, ticks: 0, scenario });
      const second = runBalance({ seed: 2026, ticks: 0, scenario });
      expect(first).toEqual(second);
      expect(first.invariantFailures).toEqual([]);
      expect(first.commandResults[0]?.preview.coveredCellCount).toBe(441);
      expect(first.commandResults[0]?.preview.sideLength).toBe(21);
    }

    const repeated = runBalance({ seed: 2026, ticks: 180, scenario: 'step10-5-repeated' });
    expect(repeated).toEqual(runBalance({ seed: 2026, ticks: 180, scenario: 'step10-5-repeated' }));
    expect(repeated.determinismHash).toMatch(/^[0-9a-f]{8}$/);
  }, 60_000);
});
