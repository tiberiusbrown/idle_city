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

describe('deterministic population growth and assignment', () => {
  it('does not grow with housing-only capacity', () => {
    const simulation = createSimulation({
      citizenCount: 1,
      housingCapacity: 4,
      workplaceCapacity: 1,
      populationCap: 4,
      populationGrowthCadenceTicks: 2,
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
      citizenCount: 1,
      housingCapacity: 1,
      workplaceCapacity: 4,
      populationCap: 4,
      populationGrowthCadenceTicks: 2,
    });

    step(simulation, 20);

    expect(simulation.getSnapshot().citizens).toHaveLength(1);
  });

  it('grows one citizen per cadence when both capacities are available', () => {
    const simulation = createSimulation({
      citizenCount: 1,
      housingCapacity: 3,
      workplaceCapacity: 3,
      populationCap: 3,
      populationGrowthCadenceTicks: 2,
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
      citizenCount: 0,
      housingCapacity: 2,
      workplaceCapacity: 2,
      populationCap: 2,
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
      citizenCount: 0,
      housingCapacity: 5,
      workplaceCapacity: 5,
      populationCap: 2,
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
      citizenCount: 0,
      housingCapacity: 6,
      workplaceCapacity: 6,
      populationCap: 6,
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
      citizenCount: 0,
      housingCapacity: 2,
      workplaceCapacity: 2,
      populationCap: 2,
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
