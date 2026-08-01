# Architecture

## Authoritative simulation

The simulation is a pure TypeScript state machine. It receives explicit configuration, owns its seeded random generator, advances only when `step()` is called, and returns detached serializable snapshots. It imports no Babylon.js code and touches no DOM or browser API. Node tests and the command-line balance runner execute the same rules as the game client.

The world is a signed logical coordinate space. A `chunkSize` is centralized (32 by default), and only the configured initial region plus explicitly activated adjacent chunks exist. Inactive chunks are blocked. Chunk keys are derived from integer coordinates, and `Math.floor` conversion keeps negative positions stable at boundaries. There is no maximum-map bounding box or preallocated grid.

## Chunk storage and footprints

Active chunks are held in stable coordinate order. Walkability uses a lazy `Uint8Array` occupancy buffer per chunk: an active chunk without a buffer is entirely walkable, and a buffer is allocated only when a footprint blocks a cell. Occupancy revisions increment only when a cell changes. This gives near-constant-time lookups without an object per logical cell.

Buildings own one authoritative world-coordinate rectangle. Homes are exactly `3 × 3`; workplaces are `5 × 5`. Occupied cells are derived in row-major order. Footprints may cross chunk boundaries and their capacity is independent of area. Exterior entrance candidates are deduplicated and sorted in row-major order; the first active, walkable, locally reachable candidate is selected. Citizens spawn and route at entrances, never in building interiors.

## Fixed steps and interpolation

The client measures elapsed wall-clock time and accumulates it. Every accumulated 200 milliseconds advances one logical tick (5 Hz at normal speed). Long frames can advance multiple steps; short frames advance none. Pausing sets the time scale to zero, while fast mode multiplies accumulated logical time.

Each simulation step copies a citizen's current logical position into `previousPosition` before applying at most one adjacent route move. At render time, the client linearly interpolates between the two logical positions using a centralized logical-cell scale. Interpolation and camera state never feed back into simulation state, including when a citizen crosses a chunk boundary or has negative coordinates.

## Deterministic paths and expansion

Pathfinding uses deterministic A* with a Manhattan heuristic, integer movement cost, fixed neighbor order, coordinate/sequence tie-breaking, and an explicit node-expansion budget. The grid seam accepts active-chunk storage and a walkability callback; `findGridPathDetailed` exposes found/no-path/budget-exhausted status plus expanded-node and touched-chunk counts. Current citizen positions are not permanent obstacles. The path API keeps a chunk-level seam available for future hierarchical routing without introducing a portal framework now.

Chunk activation is a narrow authoritative transition. It validates safe integer coordinates, rejects duplicates, requires orthogonal adjacency to an active chunk, and enforces the configured active-chunk limit. Rejected activation is mutation-free. Accepted activation creates one chunk and dirties the new chunk plus active orthogonal neighbors. Expansion is explicit and deterministic; no player-facing control or automatic policy is included in this step.

## City indicators, Data, and demand

The simulation derives normalized `space`, `access`, and `activity` indicators directly from buildings, entrance-to-entrance routes, and citizen states. Data is awarded when a citizen completes work and uses bounded efficiency from those indicators. All numeric rounding is deterministic.

Demand is stored internally by active chunk in lazy typed buffers. The ordinary snapshot exposes only global totals and stable per-chunk summaries containing chunk coordinates, revision, cell count, and totals; it deliberately does not contain a full `cells` array or inactive/bounding-box cells. `getDemandChunk` and bounded `queryDemandRegion` are explicit detached detail queries. Demand revisions increment only for evaluated dirty chunks.

Demand dirtying rules are explicit:

- Initial active chunks are dirtied once.
- A district seed dirties active chunks whose cells can fall within the configured seed-influence radius.
- A newly activated chunk dirties itself and active orthogonal neighbors because local spatial references can change at the boundary.
- A change to global metrics dirties all active chunks because the base demand formula depends on access/activity state.

Demand uses footprint distance as its spatial reference and preserves district-seed influence through a bounded Manhattan falloff. `getSnapshot()` evaluates only dirty chunks; it does not recompute all active chunks.

## Rendering projection

Babylon is downstream of snapshots. Logical-to-world conversion is centralized and uses the same cell scale for positive and negative coordinates. The renderer owns one ground resource per visible active chunk, never one resource per cell and never a resource for the maximum possible world. Visible chunks can be explicitly selected or derived around the camera target. Ground resources reconcile by stable chunk key and occupancy revision; unchanged updates do not duplicate meshes. Buildings use their footprint dimensions, while citizen interpolation uses detached logical positions.

Renderer structural counters expose visible/rendered chunks, chunk rebuilds, and mesh count for bounded-resource tests. No general building or citizen reconciliation is introduced in this step.

## Snapshots and balance runner

Snapshots scale with active chunk metadata and active entities, not coordinate extent. They contain no inactive chunks, empty bounding-box cells, or ordinary full demand fields. Detailed demand payloads are bounded and opt-in.

The headless balance runner reports active/allocated chunks, optional occupancy and demand buffers, demand dirty/evaluation counts, path nodes expanded, path chunks touched, snapshot chunk summaries, invariant failures, and a determinism hash. Structural scenarios exercise sparse outward activation, coordinate extent beyond `1000 × 1000` without filling the box, localized demand dirtying, and long multi-chunk routes.

## Deferred systems

This step intentionally does not add developer AI, construction, population growth, movement reservations, congestion costs, roads, transit, chunk removal, player-facing expansion controls, polygon footprints, or detailed voxel meshing. The next implementation should add footprint-aware deterministic developer construction and project reservations over active chunks.
