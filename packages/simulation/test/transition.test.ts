import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src';

function runUntil(
  simulation: ReturnType<typeof createSimulation>,
  predicate: (snapshot: ReturnType<typeof simulation.getSnapshot>) => boolean,
  limit = 2_000,
): ReturnType<typeof simulation.getSnapshot> {
  for (let index = 0; index < limit; index += 1) {
    const snapshot = simulation.getSnapshot();
    if (predicate(snapshot)) return snapshot;
    simulation.step();
  }
  throw new Error('Transition did not complete within the test budget.');
}

function makeSimulation(initialCitizens: readonly { id: string }[]) {
  return createSimulation({
    chunkSize: 8,
    initialActiveRegion: { minX: 0, minY: 0, width: 8, height: 8 },
    initialCitizens,
    startingData: 22,
    developmentEvaluationIntervalTicks: 1,
    populationCap: initialCitizens.length,
    constructionPhaseDurations: {
      survey: 1,
      blueprint: 1,
      foundation: 1,
      frame: 1,
      completion: 1,
    },
  });
}

describe('authoritative construction transitions', () => {
  it('chooses the same stable citizen ID regardless of fixture insertion order', () => {
    const configs = [
      [{ id: 'citizen-2' }, { id: 'citizen-1' }],
      [{ id: 'citizen-1' }, { id: 'citizen-2' }],
    ] as const;
    const runs = configs.map((initialCitizens) => {
      const simulation = makeSimulation(initialCitizens);
      expect(
        simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }),
      ).toMatchObject({
        accepted: true,
      });
      const completed = runUntil(
        simulation,
        (snapshot) => snapshot.structural.constructionProjectsCompleted > 0,
      );
      const assigned = completed.citizens
        .filter(({ homeBuildingId }) => homeBuildingId === 'home-1')
        .map(({ id }) => id);
      return { assigned, hash: simulation.getDeterminismHash() };
    });
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]?.assigned).toEqual(['citizen-1']);
  });

  it('assigns a workplace only to its physical builder at a valid access cell', () => {
    const simulation = makeSimulation([{ id: 'citizen-1' }]);
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }),
    ).toMatchObject({
      accepted: true,
    });
    runUntil(simulation, (snapshot) => snapshot.buildings.some(({ id }) => id === 'home-1'));
    expect(
      simulation.placeDistrictSeed({ kind: 'working', position: { x: 40, y: 40 } }),
    ).toMatchObject({
      accepted: true,
    });
    const constructing = runUntil(simulation, (snapshot) =>
      snapshot.citizens.some(({ activity }) => activity === 'constructing'),
    );
    const before = constructing.citizens.find(({ activity }) => activity === 'constructing');
    if (before === undefined) throw new Error('A construction worker is required.');
    const completed = runUntil(simulation, (snapshot) =>
      snapshot.buildings.some(({ id }) => id === 'workplace-1'),
    );
    const workplace = completed.buildings.find(({ id }) => id === 'workplace-1');
    const after = completed.citizens.find(({ id }) => id === before.id);
    if (workplace === undefined || after === undefined)
      throw new Error('Completed workplace is required.');
    expect(after.position).toEqual(before.position);
    expect(after.homeBuildingId).toBe('home-1');
    expect(after.workplaceBuildingId).toBe('workplace-1');
    expect(after.activity).toBe('commuting-to-work');
    expect(after.route[0]).toEqual(before.position);
    expect(after.constructionProjectId).toBeNull();
    expect(after.constructionStagingCell).toBeNull();
    expect(after.resumeDestinationBuildingId).toBeNull();
    expect(after.constructionCadenceTicks).toBe(0);
    const arrived = runUntil(simulation, (snapshot) =>
      snapshot.citizens.some(({ id, activity }) => id === before.id && activity === 'work'),
    );
    const working = arrived.citizens.find(({ id }) => id === before.id);
    if (working === undefined) throw new Error('The assigned citizen is required.');
    expect(workplace.accessCells).toContainEqual(working.position);
    expect(working.route).toEqual([]);
  });
});
