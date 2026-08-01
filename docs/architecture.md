# Architecture

## Authoritative simulation

The simulation is a pure TypeScript state machine. It receives explicit configuration, owns its seeded random generator, advances only when `step()` is called, and returns detached serializable snapshots. It imports no Babylon.js code and touches no DOM or browser API. This lets Node tests and command-line balance runs execute the exact same rules as the game client.

Rendering is intentionally downstream. Babylon meshes are projections of snapshot data and can be rebuilt or discarded at any time. Camera positions, materials, interpolation values, and mesh transforms are never authoritative and cannot influence a route or schedule.

## Fixed steps and interpolation

The client measures elapsed wall-clock time and accumulates it. Every accumulated 200 milliseconds advances one logical tick (5 Hz at normal speed). Long frames can advance multiple steps; short frames advance none. Pausing sets the time scale to zero, while fast mode multiplies accumulated logical time.

Each simulation step copies a citizen's current grid position into `previousPosition` before applying at most one adjacent route move. At render time, the client computes `alpha = accumulator / stepDuration`. The renderer linearly interpolates between the two grid positions. Since alpha is passed only to rendering and never to `step()`, 30 Hz and 144 Hz displays produce identical logical results.

## Deterministic randomness and paths

`SeededRandom` uses a small integer-state PRNG with explicitly serializable state. A seed is part of simulation configuration; random values are requested only through the owned generator. Pathfinding uses breadth-first search with a fixed neighbor order, so equally short routes resolve consistently on every supported platform. Stable key ordering and an FNV-1a hash provide compact deterministic regression summaries.

## Growth features

Future district seeds should enter through explicit simulation commands such as `placeDistrictSeed(position, kind)`. They should create demand signals, not renderer objects. Autonomous developers should be deterministic simulation systems that inspect demand, consume a seeded random stream in a documented order, and emit building state. The renderer then discovers those buildings in the next snapshot.

Keep economy, developer, zoning, and citizen systems as small modules under `packages/simulation`. UI intent becomes validated commands; events or snapshots flow back out. Versioned snapshot serialization can later support local saves without coupling persistence to Babylon or the browser shell.

## Large balance runs

The balance runner imports only simulation and shared packages. It can create many independent simulations with derived seeds, advance thousands of ticks in tight Node loops, validate invariants, and aggregate hashes or metrics without a canvas. Future benchmark commands should preserve this property and may use Node worker threads, with one complete simulation per worker to avoid shared mutable state.
