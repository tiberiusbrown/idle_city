/** A signed, integer position in the authoritative world grid. */
export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

/** Creates an immutable grid position and rejects non-integer coordinates. */
export function createGridPosition(x: number, y: number): GridPosition {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error(`Grid positions must use safe integer coordinates; received (${x}, ${y}).`);
  }

  return Object.freeze({ x, y });
}

declare const citizenIdBrand: unique symbol;

/** A stable authoritative identifier for a citizen. */
export type CitizenId = string & {
  readonly [citizenIdBrand]: 'CitizenId';
};

/** Brands a serialized citizen identifier without changing its runtime value. */
export function createCitizenId(value: string): CitizenId {
  if (value.length === 0) throw new Error('Citizen IDs must not be empty.');
  return value as CitizenId;
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, ordered(child)]),
    );
  }
  return value;
}

/** Creates a small deterministic hash for serializable values. */
export function stableHash(value: unknown): string {
  const input = JSON.stringify(ordered(value));
  let hash = 0x811c9dc5;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
