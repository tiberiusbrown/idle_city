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

## Deterministic traffic telemetry

The simulation records internal route usage only when a citizen successfully commits an adjacent logical-cell move. Physical edges are canonicalized by endpoint order `(y, x)` and expose directional `aToB`/`bToA` counts plus `total`. Route planning, blocked or rejected attempts, spawning, reset, and activity transitions do not record traffic.

Traffic history uses a ring of per-tick sparse edge-delta buckets with a default 256 logical-tick window. Expiry runs only as logical ticks advance; expired bucket deltas are subtracted from aggregate edge counters and empty edges are removed. Snapshot traffic summaries are detached, nonzero, and sorted by canonical key. The raw ring buckets remain simulation-private, and traffic does not affect A* costs, route selection, or replanning.

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

Demand uses footprint distance as its spatial reference and preserves district-seed influence through a bounded Manhattan falloff. Dirty demand chunks are refreshed during deterministic authoritative transitions: initialization, accepted seed placement, accepted chunk activation, and the end of `step()` before developer evaluation. `getSnapshot()`, `getDeterminismHash()`, `getDemandChunk()`, and bounded region queries only read and copy already-evaluated buffers, so observation cadence cannot change demand revisions or structural counters.

## Deterministic developer construction

Developers evaluate every configured logical cadence (20 ticks by default). Evaluation is RNG-free and runs only when the authoritative development state has changed. Candidates are enumerated in this order: `home`, then `workplace`; active chunks sorted by `(chunkY, chunkX)`; row-major anchors within each chunk; and exterior entrances in row-major order. A candidate is discarded unless its complete footprint is active and walkable, protects existing building/project entrances and citizen positions, and has a reachable entrance from existing walkable space.

The pure score is rounded to six decimal places after applying these normalized weights:

```text
0.30 local matching demand
+ 0.35 matching seed influence
+ 0.10 complementary use
+ 0.10 entrance accessibility
+ 0.15 expected access improvement
- 0.15 same-use saturation
- 0.05 construction cost
```

Candidates are ranked by higher score, higher seed influence, better expected access improvement, lower `y`, lower `x`, stable building-type order, then stable entrance order. At most one candidate becomes a project during an evaluation. Snapshots retain a bounded ranked candidate list and the primary player-readable reason.

The selected project's entire footprint is reserved at survey start by marking every occupied logical cell non-walkable. The reservation remains in place through completion, when those same cells become the completed building. Existing active routes that intersect a proposed reservation make that candidate ineligible; the home-to-work connection and the candidate entrance are also checked with the proposed cells blocked. This makes the point at which construction blocks travel explicit and prevents a project from invalidating a citizen route.

Construction uses centralized fixed durations: survey 2 ticks, blueprint 3, foundation 4, frame 6, and completion 1. A project starts in survey with its full reservation, advances one phase tick per `step()`, and creates a matching `Building` only after completion ends. Project IDs are `construction-project-1`, `construction-project-2`, and so on; completed buildings continue the per-type stable sequence after the initial `home-1` and `workplace-1`.

## Deterministic population growth

Population growth is evaluated once every `populationGrowthCadenceTicks` logical ticks (20 by default) after construction advances. At most one citizen is added per cadence. Growth requires both a home and a workplace with remaining capacity and stops at `populationCap` (100 by default, or the configured cap). Initial citizens are clamped to the same constraints, so occupancy never exceeds capacity.

The assignment candidate set is all compatible home/workplace pairs with free capacity and a reachable entrance-to-entrance path. Candidates are ranked by Manhattan distance between entrances, then home building ID, then workplace building ID. The selected citizen receives the next stable `citizen-N` ID, starts at the home entrance, and uses the existing home → commute → work → commute → home schedule. Population changes dirty every demand chunk because shortage, saturation, and derived metrics depend on current occupancy.

## Rendering projection

Babylon is downstream of snapshots. Logical-to-world conversion is centralized and uses the same cell scale for positive and negative coordinates. The renderer owns one ground resource per visible active chunk, never one resource per cell and never a resource for the maximum possible world. Visible chunks can be explicitly selected or derived around the camera target. Ground resources reconcile by stable chunk key and occupancy revision; unchanged updates do not duplicate meshes. Buildings use their footprint dimensions, while citizen interpolation uses detached logical positions.

The city scene owns separate renderer layers for chunk ground, completed buildings, citizens, construction projects, and district seeds. Each layer keeps a renderer-only map keyed by the authoritative snapshot ID. A snapshot-only ID creates a visual, a shared ID updates the existing visual, and a renderer-only ID disposes its visual subtree. Entity IDs are never generated or written back by the renderer. Completed buildings use footprint-sized bodies, citizens interpolate detached previous/current positions at render scale, and citizen visuals exist only when either endpoint lies in a currently rendered chunk. Projects toggle phase-specific shared-material visuals, and seeds show a marker plus bounded influence diamond. Repeating an unchanged snapshot does not create new resources. Layer disposal clears its maps and child nodes; final scene disposal releases the shared materials and remaining Babylon resources.

## Browser district placement

The Build drawer exposes only the unlocked Living and Working seed kinds. Base costs are Living 10, Working 12, and Services 20 Data; the simulation charges `ceil(baseCost × 1.25^activeSameTypeCount)` and exposes the current count-based price to the UI. The game shell reads that simulation-owned price and sends a `PlaceDistrictSeedCommand`; it does not duplicate Data, occupancy, lock, or active-chunk rules. A non-mutating simulation preview uses the same validation path to drive plain-language valid/invalid feedback before submission. Accepted and rejected command results update an `aria-live` status, while the renderer immediately reconciles the detached snapshot and projects the seed.

Pointer picking is renderer-owned. Babylon picks only visible active-chunk ground meshes, then centralized coordinate helpers convert the picked world position to a logical cell and signed chunk using floor-based conversion. The renderer owns one reusable valid/invalid placement preview mesh. The game shell tracks one primary pointer with capture and an 8 CSS pixel drag threshold; only a matching non-drag release can submit a seed. Touch uses the same pointer event path, and cancellation, lost capture, Build close, reset, and explicit cancel clear the gesture and preview without touching simulation state.

Renderer structural counters expose visible/rendered chunks, visible/rendered citizens, chunk rebuilds, and mesh count for bounded-resource tests. Ground continues to reconcile by stable chunk key and occupancy revision, while entity layers reconcile by authoritative entity ID.

## Snapshots and balance runner

Snapshots scale with active chunk metadata and active entities, not coordinate extent. They contain no inactive chunks, empty bounding-box cells, or ordinary full demand fields. Detailed demand payloads are bounded and opt-in.

The headless balance runner reports active/allocated chunks, optional occupancy and demand buffers, demand dirty/evaluation counts, path nodes expanded, path chunks touched, bounded traffic edge summaries and counters, snapshot chunk summaries, invariant failures, and a determinism hash. Structural scenarios exercise sparse outward activation, coordinate extent beyond `1000 × 1000` without filling the box, localized demand dirtying, long multi-chunk routes, and repeated traffic corridors.

## Deferred systems

This step intentionally does not add movement reservations, congestion costs, roads, transit, chunk removal, player-facing expansion controls, polygon footprints, detailed voxel meshing, services, demolition, conversion, redevelopment, construction bots, a Travel Flow overlay, Traffic Analysis research state, or traffic-dependent routing.
