import { createSimulation } from '@idle-city/simulation';

function readNumericArgument(name: string, fallback: number): number {
  const argumentIndex = process.argv.indexOf(name);
  if (argumentIndex === -1) return fallback;

  const value = process.argv[argumentIndex + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires an integer value.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} requires an integer value; received ${value}.`);
  }
  return parsed;
}

const seed = readNumericArgument('--seed', 0);
const ticks = readNumericArgument('--ticks', 0);
if (ticks < 0) {
  throw new Error(`--ticks must be a nonnegative safe integer; received ${String(ticks)}.`);
}
const workBudget = readNumericArgument('--work-budget', Number.MAX_SAFE_INTEGER);
if (workBudget <= 0) {
  throw new Error(`--work-budget must be a positive safe integer; received ${String(workBudget)}.`);
}

const simulation = createSimulation({ seed });
let completedTicks = 0;
while (completedTicks < ticks) {
  const result = simulation.advanceTickWork(workBudget);
  if (result.status === 'committed') completedTicks += 1;
}

const snapshot = simulation.getSnapshot();
const metrics = simulation.getMetrics();
const buildingCounts = {
  'single-house': { incomplete: 0, complete: 0 },
  'small-shop': { incomplete: 0, complete: 0 },
  'small-park': { incomplete: 0, complete: 0 },
};
let constructionWorkerCount = 0;
for (const building of snapshot.buildings) {
  const counts = buildingCounts[building.archetypeId];
  counts[building.state.kind] += 1;
  constructionWorkerCount += building.assignments.constructionWorkerIds.length;
}

process.stdout.write(
  `${JSON.stringify({
    tick: snapshot.tick,
    data: snapshot.data,
    population: snapshot.population,
    completedHomeCapacity: snapshot.completedHomeCapacity,
    citizens: snapshot.citizens,
    buildings: buildingCounts,
    constructionWorkerCount,
    planningJob: snapshot.planningJob,
    planningAttempts: metrics.planningAttempts,
    planningSuccesses: metrics.planningSuccesses,
    planningCandidateChecks: metrics.planningCandidateChecks,
    populationGrowthAttempts: metrics.populationGrowthAttempts,
    populationGrowthSuccesses: metrics.populationGrowthSuccesses,
    movementProposals: metrics.movementProposals,
    committedMoves: metrics.committedMoves,
    blockedMoves: metrics.blockedMoves,
    pathfindingExpansions: metrics.pathfindingExpansions,
    hash: simulation.getDeterminismHash(),
  })}\n`,
);
