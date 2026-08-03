import { describe, expect, it } from 'vitest';
import { findGridPath, findGridPathDetailed, findGridPathBetweenSets } from '../src/index';

function expectAdjacent(path: readonly { x: number; y: number }[]): void {
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (previous === undefined || current === undefined) throw new Error('Path index is missing.');
    expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
  }
}

describe('deterministic chunk-aware A*', () => {
  it('selects a shortest portal from deduplicated multi-source and multi-goal sets', () => {
    const first = findGridPathBetweenSets(
      { width: 9, height: 9 },
      [
        { x: 0, y: 4 },
        { x: 0, y: 0 },
        { x: 0, y: 4 },
      ],
      [
        { x: 8, y: 8 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
      ],
      'citizen-1|home|work',
    );
    const second = findGridPathBetweenSets(
      { width: 9, height: 9 },
      [
        { x: 0, y: 4 },
        { x: 0, y: 0 },
      ],
      [
        { x: 8, y: 0 },
        { x: 8, y: 8 },
      ],
      'citizen-1|home|work',
    );
    expect(first.status).toBe('found');
    expect(first.path.length).toBe(9);
    expect(first).toEqual(second);
    expectAdjacent(first.path);
  });

  it('uses the full source-goal hash tie key and distributes symmetric portals', () => {
    const sources = [
      { x: 0, y: 4 },
      { x: 0, y: 0 },
    ];
    const goals = [
      { x: 8, y: 0 },
      { x: 8, y: 4 },
    ];
    const picks = new Set(
      ['citizen-1', 'citizen-2', 'citizen-3', 'citizen-4'].map((id) => {
        const result = findGridPathBetweenSets({ width: 9, height: 9 }, sources, goals, id);
        return `${String(result.source?.x)},${String(result.source?.y)}|${String(result.goal?.x)},${String(result.goal?.y)}`;
      }),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('matches exact stable full-tuple winners for known tie keys', () => {
    const sources = [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
    ];
    const goals = [
      { x: 8, y: 0 },
      { x: 8, y: 4 },
    ];
    expect(findGridPathBetweenSets({ width: 9, height: 9 }, sources, goals, 'a').source).toEqual({
      x: 0,
      y: 4,
    });
    expect(findGridPathBetweenSets({ width: 9, height: 9 }, sources, goals, 'b').source).toEqual({
      x: 0,
      y: 0,
    });
    expect(findGridPathBetweenSets({ width: 9, height: 9 }, sources, goals, 'c').goal).toEqual({
      x: 8,
      y: 0,
    });
  });

  it('is permutation independent and preserves shortest pair priority', () => {
    const grid = { width: 10, height: 6 };
    const first = findGridPathBetweenSets(
      grid,
      [
        { x: 0, y: 0 },
        { x: 0, y: 5 },
      ],
      [
        { x: 9, y: 5 },
        { x: 9, y: 0 },
      ],
      'perm',
    );
    const second = findGridPathBetweenSets(
      grid,
      [
        { x: 0, y: 5 },
        { x: 0, y: 0 },
      ],
      [
        { x: 9, y: 0 },
        { x: 9, y: 5 },
      ],
      'perm',
    );
    expect(second).toEqual(first);
    const shorter = findGridPathBetweenSets(
      { width: 10, height: 6 },
      [
        { x: 0, y: 0 },
        { x: 0, y: 5 },
      ],
      [
        { x: 9, y: 0 },
        { x: 9, y: 5 },
      ],
      'a',
    );
    expect(shorter.path.length).toBe(10);
  });

  it('reports portal telemetry and bounded budget status', () => {
    const result = findGridPathBetweenSets(
      {
        chunkSize: 4,
        activeChunks: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      [{ x: 0, y: 0 }],
      [{ x: 7, y: 0 }],
      'telemetry',
    );
    expect(result.status).toBe('found');
    expect(result.chunksTouched).toBe(2);
    const limited = findGridPathBetweenSets(
      { width: 20, height: 20 },
      [{ x: 0, y: 0 }],
      [{ x: 19, y: 19 }],
      'budget',
      { maxNodes: 2 },
    );
    expect(limited.status).toBe('budget-exhausted');
    expect(limited.nodesExpanded).toBe(2);
    expect(limited.path).toEqual([]);
  });

  it('does not choose a partial equal-distance goal layer when the budget expires', () => {
    const goals = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const limited = findGridPathBetweenSets(
      { width: 3, height: 3 },
      [{ x: 0, y: 0 }],
      goals,
      'equal-layer',
      { maxNodes: 2 },
    );
    const reversed = findGridPathBetweenSets(
      { width: 3, height: 3 },
      [{ x: 0, y: 0 }],
      [...goals].reverse(),
      'equal-layer',
      { maxNodes: 2 },
    );
    expect(limited.status).toBe('budget-exhausted');
    expect(limited.path).toEqual([]);
    expect(reversed).toEqual(limited);
  });

  it('selects the full-hash winner with just enough budget for the goal layer', () => {
    const result = findGridPathBetweenSets(
      { width: 3, height: 3 },
      [{ x: 0, y: 0 }],
      [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      'equal-layer',
      { maxNodes: 3 },
    );
    expect(result.status).toBe('found');
    expect(result.source).toEqual({ x: 0, y: 0 });
    expect(result.goal).toEqual({ x: 1, y: 0 });
  });
  it('converts boundary cells across negative chunks and routes across active chunks', () => {
    const path = findGridPath(
      {
        chunkSize: 4,
        activeChunks: [
          { x: -1, y: 0 },
          { x: 0, y: 0 },
        ],
      },
      { x: -1, y: 1 },
      { x: 3, y: 1 },
    );
    expect(path[0]).toEqual({ x: -1, y: 1 });
    expect(path.at(-1)).toEqual({ x: 3, y: 1 });
    expectAdjacent(path);
  });

  it('blocks inactive chunks and reports an explicit no-path result', () => {
    const result = findGridPathDetailed(
      {
        chunkSize: 4,
        activeChunks: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
      },
      { x: 1, y: 1 },
      { x: 8, y: 1 },
    );
    expect(result.status).toBe('no-path');
    expect(result.path).toEqual([]);
    expect(result.chunksTouched).toBe(1);
  });

  it('finds a deterministic path through a narrow passage around obstacles', () => {
    const isWalkable = ({ x, y }: { x: number; y: number }): boolean => {
      if (x === 2 && y !== 4) return false;
      if (x === 3 && y < 2) return false;
      return true;
    };
    const first = findGridPath({ width: 7, height: 7, isWalkable }, { x: 0, y: 0 }, { x: 6, y: 0 });
    const second = findGridPath(
      { width: 7, height: 7, isWalkable },
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    );
    expect(first).toEqual(second);
    expectAdjacent(first);
    expect(first.some((position) => position.x === 2 && position.y === 4)).toBe(true);
  });

  it('terminates at the explicit expansion budget', () => {
    const result = findGridPathDetailed(
      { chunkSize: 8, activeChunks: [{ x: 0, y: 0 }], maxNodes: 3 },
      { x: 0, y: 0 },
      { x: 7, y: 7 },
    );
    expect(result.status).toBe('budget-exhausted');
    expect(result.nodesExpanded).toBe(3);
    expect(result.path).toEqual([]);
  });
});
