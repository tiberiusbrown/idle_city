import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/index';

describe('simulation skeleton', () => {
  it('starts with the deterministic four-citizen opening state', () => {
    const firstSimulation = createSimulation({ seed: 1234 });
    const secondSimulation = createSimulation({ seed: 1234 });
    const first = firstSimulation.getSnapshot();
    const second = firstSimulation.getSnapshot();

    expect(first).toEqual({
      tick: 0,
      data: 10,
      population: 4,
      citizens: [
        {
          id: 'citizen-1',
          position: { x: 0, y: 0 },
          previousPosition: { x: 0, y: 0 },
          movementCredit: 0,
          wanderingAnchor: { x: 0, y: 0 },
          homeBuildingId: null,
          workBuildingId: null,
          constructionBuildingId: null,
          route: null,
          activity: null,
        },
        {
          id: 'citizen-2',
          position: { x: 1, y: 0 },
          previousPosition: { x: 1, y: 0 },
          movementCredit: 0,
          wanderingAnchor: { x: 1, y: 0 },
          homeBuildingId: null,
          workBuildingId: null,
          constructionBuildingId: null,
          route: null,
          activity: null,
        },
        {
          id: 'citizen-3',
          position: { x: 0, y: 1 },
          previousPosition: { x: 0, y: 1 },
          movementCredit: 0,
          wanderingAnchor: { x: 0, y: 1 },
          homeBuildingId: null,
          workBuildingId: null,
          constructionBuildingId: null,
          route: null,
          activity: null,
        },
        {
          id: 'citizen-4',
          position: { x: 1, y: 1 },
          previousPosition: { x: 1, y: 1 },
          movementCredit: 0,
          wanderingAnchor: { x: 1, y: 1 },
          homeBuildingId: null,
          workBuildingId: null,
          constructionBuildingId: null,
          route: null,
          activity: null,
        },
      ],
      zones: [],
      nextZoneCosts: {
        living: 4,
        working: 6,
        leisure: 40,
      },
      buildings: [],
      planningJob: {
        status: 'idle',
        zoneId: null,
        archetypeId: null,
        planningSequence: 0,
        candidateChecks: 0,
      },
    });
    expect(second).toEqual(first);
    expect(first).not.toBe(second);
    expect(first.citizens).not.toBe(second.citizens);

    const mutable = first as unknown as {
      citizens: { id: string; position: { x: number; y: number } }[];
    };
    const firstCitizen = mutable.citizens[0];
    if (firstCitizen === undefined) throw new Error('Expected the first citizen.');
    firstCitizen.position.x = 99;
    mutable.citizens.push({ id: 'unrelated', position: { x: 9, y: 9 } });

    expect(firstSimulation.getSnapshot()).toEqual(secondSimulation.getSnapshot());
    expect(firstSimulation.getDeterminismHash()).toBe(secondSimulation.getDeterminismHash());
  });
});
