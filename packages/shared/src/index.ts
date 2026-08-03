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
