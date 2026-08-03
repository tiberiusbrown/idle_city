import { createSimulation } from '@idle-city/simulation';

const simulation = createSimulation();
const snapshot = simulation.getSnapshot();

process.stdout.write(
  `${JSON.stringify({ tick: snapshot.tick, hash: simulation.getDeterminismHash() })}\n`,
);
