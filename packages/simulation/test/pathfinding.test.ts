import { describe, expect, it } from 'vitest';
import { findGridPath, findGridPathDetailed } from '../src/index';

function expectAdjacent(path: readonly { x: number; y: number }[]): void {
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (previous === undefined || current === undefined) throw new Error('Path index is missing.');
    expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
  }
}

describe('deterministic chunk-aware A*', () => {
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
