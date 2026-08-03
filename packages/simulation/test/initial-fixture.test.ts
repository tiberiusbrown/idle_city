import { describe, expect, it } from 'vitest';
import { createSimulation, type SimulationConfig } from '../src';

const fixture: SimulationConfig = {
  initialActiveRegion: { minX: 0, minY: 0, width: 4, height: 4 },
  initialBuildings: [
    { id: 'home-1', type: 'home', origin: { x: 4, y: 4 } },
    { id: 'workplace-1', type: 'workplace', origin: { x: 4, y: 20 } },
  ],
  initialCitizens: [
    {
      id: 'citizen-1',
      homeBuildingId: 'home-1',
      workplaceBuildingId: 'workplace-1',
    },
  ],
};

describe('explicit deterministic initial fixtures', () => {
  it('retains the empty opening when fixtures are omitted', () => {
    const snapshot = createSimulation().getSnapshot();
    expect(snapshot.buildings).toHaveLength(0);
    expect(snapshot.constructionProjects).toHaveLength(0);
    expect(snapshot.citizens).toHaveLength(1);
    expect(snapshot.citizens[0]?.homeBuildingId).toBeNull();
  });

  it('creates detached established buildings and atomic assignments with fixed capacities', () => {
    const simulation = createSimulation(fixture);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.buildings.map(({ id }) => id)).toEqual(['home-1', 'workplace-1']);
    expect(snapshot.buildings.map(({ capacity }) => capacity)).toEqual([1, 4]);
    expect(snapshot.citizens[0]).toMatchObject({
      id: 'citizen-1',
      homeBuildingId: 'home-1',
      workplaceBuildingId: 'workplace-1',
    });
    const detached = simulation.getSnapshot();
    const detachedBuilding = detached.buildings[0];
    if (detachedBuilding === undefined) throw new Error('A detached building is required.');
    (detachedBuilding.footprint as { x: number }).x = 999;
    const originalBuilding = simulation.getSnapshot().buildings[0];
    if (originalBuilding === undefined) throw new Error('An original building is required.');
    expect(originalBuilding.footprint.x).toBe(4);
  });

  it('rejects invalid fixture references and capacity without accepting partial state', () => {
    expect(() =>
      createSimulation({
        ...fixture,
        initialCitizens: [
          { id: 'citizen-1', homeBuildingId: 'missing', workplaceBuildingId: 'workplace-1' },
        ],
      }),
    ).toThrow(/unknown building/);
    expect(() =>
      createSimulation({
        ...fixture,
        initialCitizens: Array.from({ length: 2 }, (_, index) => ({
          id: `citizen-${String(index + 1)}`,
          homeBuildingId: 'home-1',
          workplaceBuildingId: 'workplace-1',
        })),
      }),
    ).toThrow(/home capacity/);
  });

  it('rejects fixtures whose complete clearance ring crosses inactive land', () => {
    expect(() =>
      createSimulation({
        initialActiveRegion: { minX: 0, minY: 0, width: 1, height: 1 },
        initialBuildings: [{ id: 'home-1', type: 'home', origin: { x: 0, y: 0 } }],
      }),
    ).toThrow(/active clearance/);
  });

  it('exposes detached row-major active access cells', () => {
    const simulation = createSimulation(fixture);
    const before = simulation.getSnapshot().buildings[0]?.accessCells;
    if (before === undefined) throw new Error('Access cells are required.');
    expect(before).toEqual([...before].sort((left, right) => left.y - right.y || left.x - right.x));
    expect(before.every((cell) => cell.x >= 0 && cell.y >= 0)).toBe(true);
    const detached = simulation.getSnapshot();
    const detachedBuilding = detached.buildings[0];
    const detachedCell = detachedBuilding?.accessCells?.[0];
    if (detachedBuilding === undefined || detachedCell === undefined)
      throw new Error('Detached access cells are required.');
    (detachedCell as { x: number }).x = 999;
    const originalCell = simulation.getSnapshot().buildings[0]?.accessCells?.[0];
    if (originalCell === undefined) throw new Error('Original access cells are required.');
    expect(originalCell.x).not.toBe(999);
  });
});
