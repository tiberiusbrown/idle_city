import { describe, expect, it } from 'vitest';
import { stableHash, stableStringify } from '../src/index';

describe('stable serialization', () => {
  it('orders object keys recursively', () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
  });
});
