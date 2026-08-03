import { describe, expect, it } from 'vitest';
import { createSimulation, TICK_STAGE_ORDER } from '../src/index';

function advanceCompletedTicks(
  simulation: ReturnType<typeof createSimulation>,
  workBudget: number,
  tickCount: number,
  observePendingWork: boolean,
): number {
  let completedTicks = 0;
  let calls = 0;

  while (completedTicks < tickCount) {
    const committedSnapshot = simulation.getSnapshot();
    const committedHash = simulation.getDeterminismHash();
    const result = simulation.advanceTickWork(workBudget);
    calls += 1;

    if (result.status === 'committed') {
      completedTicks += 1;
      continue;
    }

    if (observePendingWork) {
      expect(simulation.getSnapshot()).toEqual(committedSnapshot);
      expect(simulation.getDeterminismHash()).toBe(committedHash);
      expect(simulation.getSnapshot()).toEqual(committedSnapshot);
      expect(simulation.getDeterminismHash()).toBe(committedHash);
    }
  }

  return calls;
}

describe('transactional tick work', () => {
  it('keeps partial work private and is equivalent across work budgets', () => {
    const budgetOneSimulation = createSimulation({ seed: 1234 });
    const largeBudgetSimulation = createSimulation({ seed: 1234 });
    const initialSnapshot = budgetOneSimulation.getSnapshot();
    const initialHash = budgetOneSimulation.getDeterminismHash();

    const firstResult = budgetOneSimulation.advanceTickWork(1);
    expect(firstResult).toEqual({
      status: 'in-progress',
      stage: TICK_STAGE_ORDER[0],
      workUnitsConsumed: 1,
    });
    expect(budgetOneSimulation.getSnapshot()).toEqual(initialSnapshot);
    expect(budgetOneSimulation.getDeterminismHash()).toBe(initialHash);

    const budgetOneCalls = advanceCompletedTicks(budgetOneSimulation, 1, 5, true);
    const largeBudgetCalls = advanceCompletedTicks(
      largeBudgetSimulation,
      Number.MAX_SAFE_INTEGER,
      5,
      false,
    );

    expect(budgetOneCalls).toBeGreaterThan(5);
    expect(largeBudgetCalls).toBe(5);
    expect(budgetOneSimulation.getSnapshot()).toEqual(largeBudgetSimulation.getSnapshot());
    expect(budgetOneSimulation.getDeterminismHash()).toBe(
      largeBudgetSimulation.getDeterminismHash(),
    );
  });
});
