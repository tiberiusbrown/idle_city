import { describe, expect, it } from 'vitest';
import { findNearestCompatiblePair, createSimulation, type Building } from '../src/index';

function step(simulation: ReturnType<typeof createSimulation>, count: number): void {
  for (let index = 0; index < count; index += 1) simulation.step();
}

function building(
  id: string,
  type: 'home' | 'workplace',
  entrance: { x: number; y: number },
  capacity = 1,
): Building {
  return {
    id,
    type,
    footprint: {
      x: entrance.x,
      y: entrance.y + 1,
      width: type === 'home' ? 3 : 5,
      height: type === 'home' ? 3 : 5,
    },
    entrance: { ...entrance },
    capacity,
  };
}

function fixture(
  homes: number,
  workplaces: number,
  citizens: number,
  populationCap = Math.max(citizens, 8),
): Parameters<typeof createSimulation>[0] {
  const initialBuildings = [
    ...Array.from({ length: homes }, (_, index) => ({
      id: `home-${String(index + 1)}`,
      type: 'home' as const,
      origin: { x: 1 + (index % 4) * 7, y: 1 + Math.floor(index / 4) * 7 },
    })),
    ...Array.from({ length: workplaces }, (_, index) => ({
      id: `workplace-${String(index + 1)}`,
      type: 'workplace' as const,
      origin: { x: 1 + (index % 2) * 14, y: 20 + Math.floor(index / 2) * 7 },
    })),
  ];
  const initialCitizens = Array.from({ length: citizens }, (_, index) => ({
    id: `citizen-${String(index + 1)}`,
    homeBuildingId: `home-${String((index % homes) + 1)}`,
    workplaceBuildingId: `workplace-${String((index % workplaces) + 1)}`,
  }));
  return {
    initialActiveRegion: { minX: 0, minY: 0, width: 4, height: 4 },
    initialBuildings,
    initialCitizens,
    populationCap,
    populationGrowthCadenceTicks: 2,
  };
}

describe('deterministic population growth and assignment', () => {
  it('does not grow with housing-only capacity', () => {
    const simulation = createSimulation({
      ...fixture(1, 1, 1, 4),
    });

    step(simulation, 20);

    const snapshot = simulation.getSnapshot();
    expect(snapshot.citizens).toHaveLength(1);
    expect(snapshot.occupancy.find(({ buildingId }) => buildingId === 'home-1')?.occupied).toBe(1);
    expect(
      snapshot.occupancy.find(({ buildingId }) => buildingId === 'workplace-1')?.occupied,
    ).toBe(1);
  });

  it('does not grow with workplace-only capacity', () => {
    const simulation = createSimulation({
      ...fixture(4, 1, 4, 5),
    });

    step(simulation, 20);

    const snapshot = simulation.getSnapshot();
    expect(snapshot.citizens).toHaveLength(4);
    expect(
      snapshot.citizens.every(
        ({ homeBuildingId, workplaceBuildingId }) =>
          homeBuildingId !== null && workplaceBuildingId !== null,
      ),
    ).toBe(true);
    expect(
      snapshot.occupancy.find(({ buildingId }) => buildingId === 'workplace-1')?.occupied,
    ).toBe(4);
  });

  it('grows one citizen per cadence when both capacities are available', () => {
    const simulation = createSimulation({
      ...fixture(3, 1, 1, 3),
    });

    simulation.step();
    expect(simulation.getSnapshot().citizens).toHaveLength(1);
    simulation.step();
    expect(simulation.getSnapshot().citizens).toHaveLength(2);
    step(simulation, 2);
    expect(simulation.getSnapshot().citizens).toHaveLength(3);
    expect(simulation.getSnapshot().citizens.map(({ id }) => id)).toEqual([
      'citizen-1',
      'citizen-2',
      'citizen-3',
    ]);
  });

  it('chooses the nearest entrance pair and uses stable building-ID ties', () => {
    const homeA = building('home-a', 'home', { x: 0, y: 0 });
    const homeB = building('home-b', 'home', { x: 10, y: 0 });
    const workA = building('work-a', 'workplace', { x: 4, y: 0 });
    const workB = building('work-b', 'workplace', { x: 20, y: 0 });
    const nearest = findNearestCompatiblePair({
      buildings: [workB, homeB, workA, homeA],
      occupancy: new Map(),
    });

    expect(nearest?.home.id).toBe('home-a');
    expect(nearest?.workplace.id).toBe('work-a');
    expect(nearest?.distance).toBe(4);

    const tieWork = building('work-tie', 'workplace', { x: 5, y: 0 });
    const tie = findNearestCompatiblePair({
      buildings: [homeB, tieWork, homeA],
      occupancy: new Map(),
    });
    expect(tie?.home.id).toBe('home-a');
    expect(tie?.workplace.id).toBe('work-tie');
  });

  it('spawns at the selected home entrance with the preserved home/work schedule', () => {
    const simulation = createSimulation({
      ...fixture(2, 1, 0, 2),
      populationGrowthCadenceTicks: 1,
      activityDurationTicks: 1,
    });

    simulation.step();
    const snapshot = simulation.getSnapshot();
    const citizen = snapshot.citizens[0];
    const home = snapshot.buildings.find(({ type }) => type === 'home');
    const workplace = snapshot.buildings.find(({ type }) => type === 'workplace');
    if (citizen === undefined || home === undefined || workplace === undefined) {
      throw new Error('The growth test requires one assigned citizen and two buildings.');
    }
    expect(citizen.id).toBe('citizen-1');
    expect(citizen.position).toEqual(home.entrance);
    expect(citizen.previousPosition).toEqual(home.entrance);
    expect(citizen.homeBuildingId).toBe(home.id);
    expect(citizen.workplaceBuildingId).toBe(workplace.id);
    expect(citizen.activity).toBe('home');
    expect(citizen.activityTicksRemaining).toBeGreaterThan(0);
    expect(citizen.route).toEqual([]);
  });

  it('never exceeds capacity or population cap and exposes consistent occupancy', () => {
    const simulation = createSimulation({
      ...fixture(2, 1, 0, 2),
      populationGrowthCadenceTicks: 1,
    });

    step(simulation, 20);

    const snapshot = simulation.getSnapshot();
    expect(snapshot.citizens).toHaveLength(2);
    expect(snapshot.citizens.length).toBeLessThanOrEqual(snapshot.populationCap);
    expect(
      snapshot.occupancy.every(
        ({ occupied, capacity, available }) =>
          occupied >= 0 && occupied <= capacity && available === capacity - occupied,
      ),
    ).toBe(true);
  });

  it('keeps schedules, IDs, demand, and hashes deterministic over a long run', () => {
    const configuration = {
      seed: 90210,
      ...fixture(6, 2, 0, 6),
      populationGrowthCadenceTicks: 3,
      activityDurationTicks: 1,
    } as const;
    const left = createSimulation(configuration);
    const right = createSimulation(configuration);
    for (let tick = 0; tick < 500; tick += 1) {
      left.step();
      right.step();
    }

    const snapshot = left.getSnapshot();
    expect(snapshot).toEqual(right.getSnapshot());
    expect(left.getDeterminismHash()).toBe(right.getDeterminismHash());
    expect(snapshot.citizens.map(({ id }) => id)).toEqual([
      'citizen-1',
      'citizen-2',
      'citizen-3',
      'citizen-4',
      'citizen-5',
      'citizen-6',
    ]);
    expect(
      snapshot.citizens.every(({ activityTicksRemaining }) => activityTicksRemaining >= 0),
    ).toBe(true);
    const demandChunk = left.getDemandChunk({ x: 0, y: 0 });
    if (demandChunk === undefined) throw new Error('The initial demand chunk must exist.');
    expect(
      demandChunk.cells.every(({ living, working, services }) =>
        [living, working, services].every((value) => value >= 0 && value <= 1),
      ),
    ).toBe(true);
  });

  it('updates bounded demand when population grows', () => {
    const simulation = createSimulation({
      ...fixture(2, 1, 0, 2),
      populationGrowthCadenceTicks: 1,
    });
    const before = simulation.getSnapshot();
    simulation.step();
    const after = simulation.getSnapshot();

    expect(after.citizens).toHaveLength(1);
    expect(after.demand.totals).not.toEqual(before.demand.totals);
    expect(after.demand.chunks[0]?.revision).toBeGreaterThan(
      before.demand.chunks[0]?.revision ?? 0,
    );
    const demandChunk = simulation.getDemandChunk({ x: 0, y: 0 });
    if (demandChunk === undefined) throw new Error('The initial demand chunk must exist.');
    expect(
      demandChunk.cells.every(({ living, working, services }) =>
        [living, working, services].every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 1,
        ),
      ),
    ).toBe(true);
  });
});
