import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/index';

function completeOneTick(simulation: ReturnType<typeof createSimulation>): void {
  while (simulation.advanceTickWork(Number.MAX_SAFE_INTEGER).status !== 'committed') {
    // A large budget normally commits in one call; keep the helper correct if stages grow.
  }
}

describe('fixed-point wandering movement', () => {
  it('moves at half-cell speed no more often than every other tick and caps credit', () => {
    const simulation = createSimulation({ seed: 1234 });
    let lastMoveTick = 0;
    let movedAtLeastOnce = false;

    for (let tick = 1; tick <= 24; tick += 1) {
      completeOneTick(simulation);
      const citizen = simulation.getSnapshot().citizens[0];
      if (citizen === undefined) throw new Error('Expected the first citizen.');

      expect(citizen.movementCredit).toBeGreaterThanOrEqual(0);
      expect(citizen.movementCredit).toBeLessThanOrEqual(1024);

      const moved =
        citizen.position.x !== citizen.previousPosition.x ||
        citizen.position.y !== citizen.previousPosition.y;
      if (!moved) continue;

      movedAtLeastOnce = true;
      expect(tick - lastMoveTick).toBeGreaterThanOrEqual(2);
      lastMoveTick = tick;
    }

    expect(movedAtLeastOnce).toBe(true);
  });

  it('keeps four deterministic citizens distinct and inside each wandering anchor', () => {
    const simulation = createSimulation({ seed: 5678 });

    for (let tick = 0; tick < 24; tick += 1) {
      completeOneTick(simulation);
      const snapshot = simulation.getSnapshot();
      const occupied = new Set(
        snapshot.citizens.map(
          (citizen) => `${String(citizen.position.x)},${String(citizen.position.y)}`,
        ),
      );
      expect(occupied.size).toBe(4);

      for (const citizen of snapshot.citizens) {
        expect(
          Math.max(
            Math.abs(citizen.position.x - citizen.wanderingAnchor.x),
            Math.abs(citizen.position.y - citizen.wanderingAnchor.y),
          ),
        ).toBeLessThanOrEqual(16);
      }
    }
  });
});
