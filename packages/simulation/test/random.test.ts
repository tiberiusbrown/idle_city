import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/index';

describe('SeededRandom', () => {
  it('reproduces a sequence from the same seed', () => {
    const left = new SeededRandom(1234);
    const right = new SeededRandom(1234);
    expect(Array.from({ length: 20 }, () => left.next())).toEqual(
      Array.from({ length: 20 }, () => right.next()),
    );
  });

  it('produces a different sequence from a different seed', () => {
    expect(new SeededRandom(1).next()).not.toBe(new SeededRandom(2).next());
  });
});
