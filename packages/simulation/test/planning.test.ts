import { describe, expect, it } from 'vitest';
import {
  BUILDING_ARCHETYPES,
  createSimulation,
  validateBuildingPlacement,
  type PlaceZoneCommand,
} from '../src/index';

const livingPlacement: PlaceZoneCommand = {
  type: 'place-zone',
  zoneType: 'living',
  rect: { x: 24, y: -13, width: 13, height: 13 },
  expectedCost: 4,
};

function completeOneTick(
  simulation: ReturnType<typeof createSimulation>,
  workBudget: number,
): void {
  while (simulation.advanceTickWork(workBudget).status !== 'committed') {
    // The small-budget assertion intentionally exercises the private planning cursor.
  }
}

describe('deterministic building planning', () => {
  it('creates one compatible valid incomplete site from a controlled opportunity', () => {
    const simulation = createSimulation({ seed: 1234, planningChance: 1 });
    simulation.placeZone(livingPlacement);
    completeOneTick(simulation, Number.MAX_SAFE_INTEGER);

    const snapshot = simulation.getSnapshot();
    const zone = snapshot.zones[0];
    const building = snapshot.buildings[0];
    if (zone === undefined || building === undefined) throw new Error('Expected a planned site.');

    const validation = validateBuildingPlacement({
      archetype: BUILDING_ARCHETYPES['single-house'],
      zone,
      origin: building.origin,
      transform: building.transform,
      citizens: snapshot.citizens,
    });

    expect(validation.valid).toBe(true);
    expect(building.zoneId).toBe(zone.id);
    expect(building.archetypeId).toBe('single-house');
    expect(building.state).toEqual({
      kind: 'incomplete',
      laborCompleted: 0,
      laborRequired: 100,
    });
    expect(snapshot.planningJob.status).toBe('accepted');
    expect(simulation.getMetrics()).toMatchObject({
      planningAttempts: 1,
      planningSuccesses: 1,
    });
  });

  it('selects the same site and hash with one work unit or an unlimited budget', () => {
    const oneUnit = createSimulation({ seed: 5678, planningChance: 1 });
    const unlimited = createSimulation({ seed: 5678, planningChance: 1 });
    oneUnit.placeZone(livingPlacement);
    unlimited.placeZone(livingPlacement);

    completeOneTick(oneUnit, 1);
    completeOneTick(unlimited, Number.MAX_SAFE_INTEGER);

    expect(oneUnit.getSnapshot()).toEqual(unlimited.getSnapshot());
    expect(oneUnit.getDeterminismHash()).toBe(unlimited.getDeterminismHash());
  });
});
