import { describe, expect, it } from 'vitest';
import { createSimulation, type PlaceZoneCommand } from '../src/index';

function completeOneTick(simulation: ReturnType<typeof createSimulation>): void {
  while (simulation.advanceTickWork(Number.MAX_SAFE_INTEGER).status !== 'committed') {
    // Keep this helper correct if a later stage becomes resumable.
  }
}

function placeZoneCommand(
  zoneType: PlaceZoneCommand['zoneType'],
  x: number,
  y: number,
  expectedCost: number,
): PlaceZoneCommand {
  const size = zoneType === 'leisure' ? 8 : 13;
  return {
    type: 'place-zone',
    zoneType,
    rect: { x, y, width: size, height: size },
    expectedCost,
  };
}

describe('authoritative zones', () => {
  it('places the first Living and Working zones for exactly 10 Data', () => {
    const simulation = createSimulation({ seed: 1234 });
    simulation.placeZone(placeZoneCommand('living', 24, -13, 4));
    simulation.placeZone(placeZoneCommand('working', -13, 24, 6));

    completeOneTick(simulation);

    const snapshot = simulation.getSnapshot();
    expect(snapshot.data).toBe(0);
    expect(snapshot.zones.map((zone) => [zone.id, zone.type, zone.rect])).toEqual([
      ['zone-1', 'living', { x: 24, y: -13, width: 13, height: 13 }],
      ['zone-2', 'working', { x: -13, y: 24, width: 13, height: 13 }],
    ]);
    expect(snapshot.zones.every((zone) => zone.placementTick === 1)).toBe(true);
    expect(snapshot.zones.every((zone) => zone.immediatePlanningOpportunity)).toBe(true);
    expect(snapshot.nextZoneCosts).toEqual({ living: 5, working: 8, leisure: 40 });
    expect(simulation.getLastCommandResults().every((result) => result.accepted)).toBe(true);
  });

  it('rejects a stale-cost placement without changing the committed state', () => {
    const initialLiving = placeZoneCommand('living', 24, -13, 4);
    const staleLiving = placeZoneCommand('living', 24, -13, 4);
    const subject = createSimulation({ seed: 5678 });
    const control = createSimulation({ seed: 5678 });

    subject.placeZone(initialLiving);
    control.placeZone(initialLiving);
    completeOneTick(subject);
    completeOneTick(control);

    subject.placeZone(staleLiving);
    completeOneTick(subject);
    completeOneTick(control);

    expect(subject.getSnapshot()).toEqual(control.getSnapshot());
    expect(subject.getDeterminismHash()).toBe(control.getDeterminismHash());
    expect(subject.getLastCommandResults()).toEqual([
      { accepted: false, tick: 2, currentCost: 5, reason: 'stale-cost' },
    ]);
  });
});
