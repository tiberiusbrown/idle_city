import { describe, expect, it } from 'vitest';
import {
  buildingFootprint,
  completedBuildingAccessCells,
  createSimulation,
  findGridPathBetweenSets,
  isExteriorEntrance,
} from '../src/index';

describe('completed building access cells', () => {
  it.each([
    ['home', 3, 3, 12],
    ['workplace', 5, 5, 20],
    ['service', 4, 4, 16],
  ] as const)('derives stable orthogonal access for %s', (type, _w, _h, count) => {
    const cells = completedBuildingAccessCells(buildingFootprint({ x: 10, y: 10 }, type));
    expect(cells).toHaveLength(count);
    expect(cells).toEqual([...cells].sort((a, b) => a.y - b.y || a.x - b.x));
    expect(
      cells.every((cell) => isExteriorEntrance(cell, buildingFootprint({ x: 10, y: 10 }, type))),
    ).toBe(true);
  });

  it('routes around a blocked destination side through another valid access cell', () => {
    const footprint = buildingFootprint({ x: 10, y: 10 }, 'workplace');
    const access = completedBuildingAccessCells(footprint);
    const blocked = access[0];
    if (blocked === undefined) throw new Error('A destination access cell is required.');
    const result = findGridPathBetweenSets(
      {
        chunkSize: 32,
        activeChunks: [{ x: 0, y: 0 }],
        isWalkable: (position) => !(position.x === blocked.x && position.y === blocked.y),
        maxNodes: 10_000,
      },
      [{ x: 0, y: 12 }],
      access,
      'access-routing-test',
    );
    expect(result.status).toBe('found');
    expect(result.path.at(-1)).not.toEqual(blocked);
    expect(access).toContainEqual(result.path.at(-1));
  });

  it('claims a source access, arrives at a valid destination access once, and records traffic', () => {
    const simulation = createSimulation({
      initialActiveRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      initialBuildings: [
        { id: 'home-1', type: 'home', origin: { x: 1, y: 1 } },
        { id: 'workplace-1', type: 'workplace', origin: { x: 10, y: 1 } },
      ],
      initialCitizens: [
        { id: 'citizen-1', homeBuildingId: 'home-1', workplaceBuildingId: 'workplace-1' },
      ],
      activityDurationTicks: 1,
    });
    const initial = simulation.getSnapshot();
    const home = initial.buildings.find(({ id }) => id === 'home-1');
    if (home === undefined) throw new Error('The source home is required.');
    expect(home.accessCells).toContainEqual(initial.citizens[0]?.position);
    let completed = 0;
    for (let tick = 0; tick < 100; tick += 1) {
      simulation.step();
      const snapshot = simulation.getSnapshot();
      completed = snapshot.completedTrips;
      if (completed > 0) {
        const workplace = snapshot.buildings.find(({ id }) => id === 'workplace-1');
        expect(workplace).toBeDefined();
        expect(workplace?.accessCells).toContainEqual(snapshot.citizens[0]?.position);
        expect(completed).toBe(1);
        expect(snapshot.structural.trafficTraversalEventsRecorded).toBeGreaterThan(0);
        break;
      }
    }
    expect(completed).toBe(1);
  });

  it('keeps a citizen safely inside when no source route can be claimed', () => {
    const simulation = createSimulation({
      pathSearchBudget: 1,
      initialActiveRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      initialBuildings: [
        { id: 'home-1', type: 'home', origin: { x: 1, y: 1 } },
        { id: 'workplace-1', type: 'workplace', origin: { x: 10, y: 1 } },
      ],
      initialCitizens: [
        { id: 'citizen-1', homeBuildingId: 'home-1', workplaceBuildingId: 'workplace-1' },
      ],
      activityDurationTicks: 1,
    });
    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    const snapshot = simulation.getSnapshot();
    const citizen = snapshot.citizens[0];
    const home = snapshot.buildings.find(({ id }) => id === 'home-1');
    if (citizen === undefined || home === undefined) throw new Error('The fixture is incomplete.');
    expect(home.accessCells).toContainEqual(citizen.position);
    expect(citizen.constructionProjectId).toBeNull();
    expect(citizen.serviceDestinationBuildingId).toBeNull();
    expect(snapshot.structural.movementCommittedMoves).toBe(0);
  });
});
