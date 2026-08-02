import { describe, expect, it } from 'vitest';
import { logicalCellToChunk, worldToChunk, worldToLogicalCell } from '../src/index';

describe('centralized pointer projection coordinates', () => {
  it('rounds picked world positions down into logical cells', () => {
    expect(worldToLogicalCell({ x: 0.25, z: 0.5 })).toEqual({ x: 1, y: 2 });
    expect(worldToLogicalCell({ x: -0.01, z: -0.26 })).toEqual({ x: -1, y: -2 });
  });

  it('uses signed floor-based chunks for projected cells', () => {
    expect(logicalCellToChunk({ x: -1, y: -32 }, 32)).toEqual({ x: -1, y: -1 });
    expect(worldToChunk({ x: -0.01, z: 8.01 }, 32)).toEqual({ x: -1, y: 1 });
  });
});
