import { describe, expect, it } from 'vitest';
import { findGridPath } from '../src/index';

describe('findGridPath', () => {
  it('returns an adjacent in-bounds path around blocked cells', () => {
    const path = findGridPath(
      { width: 5, height: 5, isWalkable: ({ x, y }) => !(x === 2 && y < 4) },
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    );
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)).toEqual({ x: 4, y: 0 });
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      if (previous === undefined || current === undefined) {
        throw new Error('Path indexes must resolve during adjacency checks.');
      }
      expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
      expect(current.x).toBeGreaterThanOrEqual(0);
      expect(current.y).toBeGreaterThanOrEqual(0);
      expect(current.x).toBeLessThan(5);
      expect(current.y).toBeLessThan(5);
    }
  });
});
