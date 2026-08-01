export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    if (!Number.isSafeInteger(seed))
      throw new Error(`Seed must be a safe integer; received ${String(seed)}.`);
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  public nextInteger(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`Maximum must be a positive safe integer; received ${String(maxExclusive)}.`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  public getState(): number {
    return this.state;
  }
}
