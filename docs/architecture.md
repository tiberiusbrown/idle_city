# Architecture

## Authoritative simulation

The simulation is a pure TypeScript state machine. It receives explicit configuration, owns its seeded random generator, advances only when `step()` is called, and returns detached serializable snapshots. It imports no Babylon.js code and touches no DOM or browser API. Node tests and the command-line balance runner execute the same rules as the game client.

The world is a signed logical coordinate space. A `chunkSize` is centralized (32 by default), and only the configured initial region plus explicitly activated adjacent chunks exist. Inactive chunks are blocked. Chunk keys are derived from integer coordinates, and `Math.floor` conversion keeps negative positions stable at boundaries. There is no maximum-map bounding box or preallocated grid.

## Chunk storage and footprints

Active chunks are held in stable coordinate order. Walkability uses a lazy `Uint8Array` occupancy buffer per chunk: an active chunk without a buffer is entirely walkable, and a buffer is allocated only when a footprint blocks a cell. Public right-of-way uses a separate lazy chunk-local `Uint8Array`; ROW is walkable but not buildable. Occupancy, ROW, and combined static-topology revisions are explicit and detached in active-chunk snapshots. This gives near-constant-time lookups without an object per logical cell.

Buildings own one authoritative world-coordinate rectangle. Homes are exactly `3 × 3`; workplaces are `5 × 5`. Occupied cells are derived in row-major order. Footprints may cross chunk boundaries and their capacity is independent of area. Exterior entrance candidates are deduplicated and sorted in row-major order; the first active, walkable, locally reachable candidate is selected. Citizens spawn and route at entrances, never in building interiors.

Services buildings are `4 x 4` with capacity 8. Every building also derives a one-cell circulation envelope around its footprint. The envelope must be fully active, protected from other completed or project footprints, and provide at least three staging-capable cells.

## Fixed steps and interpolation

The client measures elapsed wall-clock time and accumulates it. Every accumulated 200 milliseconds advances one logical tick (5 Hz at normal speed). Long frames can advance multiple steps; short frames advance none. Pausing sets the time scale to zero, while fast mode multiplies accumulated logical time.

Each simulation step copies a citizen's current logical position into `previousPosition` before applying at most one adjacent route move. At render time, the client linearly interpolates between the two logical positions using a centralized logical-cell scale. Interpolation and camera state never feed back into simulation state, including when a citizen crosses a chunk boundary or has negative coordinates.

## Deterministic traffic telemetry

The simulation records internal route usage only when a citizen successfully commits an adjacent logical-cell move. Physical edges are canonicalized by endpoint order `(y, x)` and expose directional `aToB`/`bToA` counts plus `total`. Route planning, blocked or rejected attempts, spawning, reset, and activity transitions do not record traffic.

Traffic history uses a ring of per-tick sparse edge-delta buckets with a default 256 logical-tick window. Expiry runs only as logical ticks advance; expired bucket deltas are subtracted from aggregate edge counters and empty edges are removed. Snapshot traffic summaries are detached, nonzero, and sorted by canonical key. The raw ring buckets remain simulation-private, and traffic does not affect A* costs, route selection, or replanning.

## Deterministic movement reservations

Step 9 gives ordinary commuters and construction commuters/workers exclusive movement-cell occupancy. Citizens at home or work, including a citizen that has just arrived at an entrance, do not reserve that entrance. A tick snapshots only active exclusive occupancy, builds one sorted next-cell proposal per eligible commuter, validates route state plus active/static walkability, resolves target conflicts by wait age, remaining route length, trip start tick, and stable citizen ID, then resolves dependencies against cells proposed to be vacated. Accepted moves are committed simultaneously. Cycles of length three or greater are accepted; ordinary two-citizen swaps are rejected. An arrival changes to its inside-building or construction activity and releases its movement cell in the same commit. Detached `previousPosition` values remain available for renderer interpolation.

Blocked proposals increment `waitTicks`; accepted moves reset it. A deterministic bounded A* replan is attempted at waits 4, 8, 12, and so on. The recovery search blocks other start-of-tick moving cells temporarily and uses edge cost `100 + min(150, 50 × orthogonalQueueNeighbors)` with a Manhattan heuristic scaled by 100. It uses only the current tick's occupancy and wait state, never historical traffic. A valid route is installed only when it differs from the remaining route; failed and identical searches leave the existing route untouched. Repeated identical direct head-on pairs are tracked by stable citizen pair ID and exact endpoint state. After 12 consecutive blocked ticks, one atomic emergency swap is allowed; movement, a route change, trip completion, or topology change resets the relevant deadlock state. Cumulative proposal, commit, block, conflict, cycle, replan, unchanged-replan, and recovery counters are exposed in structural snapshots. Traffic telemetry is recorded only for committed reservation moves.

## Deterministic paths and expansion

Pathfinding uses deterministic A* with integer movement cost, a fixed profile-specific neighbor order, coordinate/sequence tie-breaking, and an explicit node-expansion budget. Each citizen derives `routeTieProfile = stableHash(citizenId) mod 4`; the profile affects only equal-cost ties, so every profile preserves the shortest path length. Home, work, service, and construction trips use the same profile; non-citizen validation paths use profile 0. The grid seam accepts active-chunk storage and a walkability callback; `findGridPathDetailed` exposes found/no-path/budget-exhausted status plus expanded-node and touched-chunk counts. Current citizen positions are not permanent obstacles. The path API keeps a chunk-level seam available for future hierarchical routing without introducing a portal framework now.

Chunk activation is a narrow authoritative transition. It validates safe integer coordinates, rejects duplicates, requires orthogonal adjacency to an active chunk, and enforces the configured active-chunk limit. Rejected activation is mutation-free. Accepted activation creates one chunk and dirties the new chunk plus active orthogonal neighbors. Expansion is explicit and deterministic; no player-facing control or automatic policy is included in this step.

## City indicators, Data, and demand

The simulation derives normalized `space`, `access`, and `activity` indicators directly from buildings, entrance-to-entrance routes, and citizen states. Data is awarded when a citizen completes work and uses bounded efficiency from those indicators. All numeric rounding is deterministic.

Demand is stored internally by active chunk in lazy typed buffers. The ordinary snapshot exposes only global totals and stable per-chunk summaries containing chunk coordinates, revision, cell count, and totals; it deliberately does not contain a full `cells` array or inactive/bounding-box cells. `getDemandChunk` and bounded `queryDemandRegion` are explicit detached detail queries. Demand revisions increment only for evaluated dirty chunks.

Demand dirtying rules are explicit:

- Initial active chunks are dirtied once.
- A district seed dirties active chunks whose cells can fall within the configured seed-influence radius.
- A newly activated chunk dirties itself and active orthogonal neighbors because local spatial references can change at the boundary.
- A change to global metrics dirties all active chunks because the base demand formula depends on access/activity state.

Demand uses Chebyshev footprint distance as its spatial reference and preserves district-seed influence through bounded square falloff. Dirty demand chunks are refreshed during deterministic authoritative transitions: initialization, accepted seed placement, accepted chunk activation, and the end of `step()` before developer evaluation. `getSnapshot()`, `getDeterminismHash()`, `getDemandChunk()`, and bounded region queries only read and copy already-evaluated buffers, so observation cadence cannot change demand revisions or structural counters. Seed neighborhood radii are simulation definitions—Living 10 with side 21, Working 12 with side 25, and Services 8 with side 17—and never derive from chunk size. Each contribution and running total is rounded to six decimals and matching types cap at 1. Services local-capacity coverage uses the same Chebyshev radius-8 rule.

## Deterministic developer construction and citizen labor

Developers start an RNG-free incremental job on the configured logical cadence (20 ticks by default). The job is superseded when the explicit development-state version changes; a superseded job cannot start a project. Candidates are enumerated in this order: `home`, then `workplace`, then `service`; relevant active chunks sorted by `(chunkY, chunkX)`; and row-major anchors within each chunk. Relevant chunks are those within the fixed radius of a matching seed, or all active chunks under Space or Services pressure. Each logical tick checks at most 512 cheap anchors and retains at most 32 preliminary candidates. Finalists are validated in ranked order, at most four per tick and at most 2,048 paired corridor-state expansions per tick. Sorting is bounded to the 32-entry preliminary set.

Candidate validation rejects a footprint that is inactive, occupied, reserved, on ROW, inside an existing envelope, or occupied by a citizen's current exclusive movement cell. It requires a complete active envelope, an exterior entrance, and at least three staging-capable envelope cells. The starter envelopes are joined by a deterministic two-cell-wide connector; every later accepted project reserves its footprint, envelope, and connector atomically.

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

Candidates are ranked by higher score, higher seed influence, better expected access improvement, lower `y`, lower `x`, stable building-type order, then stable entrance order. A paired connector search uses A* over adjacent-cell pair states. Its tie order is lower `f`, lower `g`, fewer turns, row-major first pair, row-major second pair, horizontal before vertical orientation, then insertion sequence. Straight transitions translate the pair; turns share one cell inside a deterministic `2 × 2` block. At most one candidate becomes a project during a complete evaluation. Snapshots retain a bounded ranked candidate list, connector cells, envelope, and the primary player-readable reason.

The selected project's entire footprint is reserved at survey start by marking every occupied logical cell non-walkable. The reservation remains in place through completion, when those same cells become the completed building. Existing ROW is reusable and never consumed. Routine all-citizen route preservation and all entrance-pair validation were removed from candidate scoring; after acceptance, only citizens whose stored future route intersects the new footprint are replanned. A candidate is rejected if a citizen currently occupies its footprint. This keeps project evaluation bounded while preserving Step 9's movement reservations and deadlock semantics.

Each accepted project stores exactly three distinct staging cells. Selection puts the entrance first, then uses shortest distance along the circulation perimeter, followed by `(y, x)`. The cells are marked ROW at project start and are reserved exclusively only while assigned to a citizen. A project cannot start unless all three cells are valid.

Construction labor is authoritative. The phase contracts are survey `2/1`, blueprint `3/1`, foundation `8/2`, frame `18/3`, and completion `2/2` for labor/max-workers. One constructing citizen contributes one unit per logical tick. Existing citizens can be recruited only when a completed home/work activity reaches its boundary; ordinary activity and commutes are not interrupted. The saved ordinary destination is resumed after release. Assignment candidates are sorted by project ID, shortest reachable route length, staging index, then citizen ID, so citizen storage order cannot affect staffing.

Each active project stores `ticksSinceLastLabor`, resetting it whenever labor
is contributed and incrementing it on a zero-labor tick. At 12 zero-labor
ticks, a project designates at most one critical lead builder from its assigned
workers who is still commuting with route cells remaining. The selection is
greater wait age, fewer remaining route cells, earlier trip start tick, then
stable citizen ID. Critical priority is considered only for same-target
proposal conflicts; all occupancy, dependency, cycle, and one-cell-per-tick
rules remain authoritative. Critical state and its plain-language reason clear
on labor, arrival, reassignment, completion, or trip change. No eligible
assigned worker means no critical designation.

The tick order is: advance the logical tick and telemetry window; snapshot exclusive occupancy; decrement ordinary activity timers and recruit only boundary citizens; build and resolve ordinary and construction-commute proposals; commit all accepted moves and record traffic; turn construction arrivals into `constructing`; aggregate labor; advance at most one phase; retain the lowest citizen IDs up to the next cap and release excess/final workers; grow population; calculate work and service Data by source; refresh demand; then advance the developer job. No labor carries into the next phase, and a phase with no constructing workers remains paused.

Construction commutes use the same deterministic A* and proposal/resolution/commit path as ordinary movement. Committed construction movement contributes normal traffic telemetry. Staging cells participate in exclusive occupancy only while reserved by a worker. Construction labor creates zero Data, but citizens retain their home/work assignments and capacity occupancy throughout.

The snapshot exposes phase labor completed/required, assigned worker count, paused state, and detached staging cells. Citizens expose their project ID, staging assignment, and saved ordinary destination. Structural counters include assignment offers/acceptances, construction movement and arrivals, labor units, paused project ticks, phase completions, and worker releases. Observation is pure: snapshots and hashes do not advance labor or alter counters.

Construction uses the existing full-staff target durations: survey 2 ticks, blueprint 3, foundation 4, frame 6, and completion 1. They sum to 16 full-staff target ticks; they are no longer unconditional timer advances. Understaffing extends the phase, and no eligible workers can pause it indefinitely. A matching `Building` appears only after final labor. Project IDs are `construction-project-1`, `construction-project-2`, and so on; completed buildings continue the per-type stable sequence after the initial `home-1` and `workplace-1`.

## Services Core and citizen services

Services Core is the first explicit progression state and costs exactly 50 Data. Its authoritative requirements are one Living seed, one Working seed, population at least 20, and 40 completed work activities. A purchase command must include `space`, `access`, or `activity`; accepted purchase deducts once, records the selected focus, and unlocks the Services seed. Rejected purchases return one stable reason without consuming RNG, IDs, or Data. Rank-1 effects are not part of this slice.

Services seed placement uses the existing preview-and-confirm command path. It remains locked before Core, costs base 20 with the existing same-type exponential price, and contributes only matching Services influence within the fixed square radius of 8 (side 17). Services local-capacity coverage uses the same Chebyshev radius. A completed service building has a 4 x 4 footprint, capacity 8, an exterior entrance, a one-cell envelope, three staging cells, and a two-cell-wide ROW connector.

Citizens carry integer `serviceNeed` in `[0, 4]`. Completing work adds one, and a citizen at home with need at least 2 attempts a completed, reachable, capacity-compatible Services destination before its next work trip. The service use activity lasts exactly two logical ticks, then subtracts exactly 2 need and contributes one base activity value through the shared city-efficiency multiplier. If no destination is available, need is retained and the ordinary home/work loop continues. Destination scores are normalized, rounded to six decimals, and tied by score, route length, occupancy ratio, then stable building ID; reservations are counted authoritatively through the destination reference.

The destination score is the rounded, clamped sum `0.50 × needValue + 0.20 × availableQuality − 0.20 × routeCost − 0.10 × expectedWait`, where `needValue = serviceNeed / 4`, `availableQuality = 1 − occupancyRatio`, `routeCost = min(1, routeLength / 64)`, and `expectedWait = occupancyRatio`. Services demand is disabled before Core; after unlock each cell uses `0.55 × (0.60 × needPressure + 0.40 × capacityShortage) + 0.45 × (1 − localCapacityCoverage)`, rounded component-by-component and clamped to `[0, 1]`. Need pressure, shortage, and coverage are bounded aggregates, and local capacity coverage always uses the fixed radius-8 Chebyshev neighborhood independent of chunk size.

## Deterministic population growth

Population growth is evaluated once every `populationGrowthCadenceTicks` logical ticks (20 by default) after construction advances. At most one citizen is added per cadence. Growth requires both a home and a workplace with remaining capacity and stops at `populationCap` (100 by default, or the configured cap). Initial citizens are clamped to the same constraints, so occupancy never exceeds capacity.

The assignment candidate set is all compatible home/workplace pairs with free capacity and a reachable entrance-to-entrance path. Candidates are ranked by Chebyshev distance between entrances, then home building ID, then workplace building ID. The selected citizen receives the next stable `citizen-N` ID, starts at the home entrance, and uses the existing home → commute → work → commute → home schedule. Population changes dirty every demand chunk because shortage, saturation, and derived metrics depend on current occupancy.

## Rendering projection

Babylon is downstream of snapshots. Logical-to-world conversion is centralized and uses the same cell scale for positive and negative coordinates. The renderer owns one ground resource per visible active chunk, never one resource per cell and never a resource for the maximum possible world. Visible chunks can be explicitly selected or derived around the camera target. Ground resources reconcile by stable chunk key and explicit occupancy/static-topology revisions; unchanged updates do not duplicate meshes. Buildings use their footprint dimensions, while citizen interpolation uses detached logical positions.

The city scene owns separate renderer layers for chunk ground, completed buildings, citizens, construction projects, and district seeds. Each layer keeps a renderer-only map keyed by the authoritative snapshot ID. A snapshot-only ID creates a visual, a shared ID updates the existing visual, and a renderer-only ID disposes its visual subtree. Entity IDs are never generated or written back by the renderer. Completed buildings use footprint-sized bodies, citizens interpolate detached previous/current positions at render scale, and citizen visuals exist only when either endpoint lies in a currently rendered chunk. Construction-assigned citizens use a distinct shared material. Project foundation, frame, and completion visuals scale progressively from the detached labor ratio; paused projects use a shared paused material. No mesh is created per labor unit, and repeated snapshots do not create resources. Seeds show one compact marker plus bounded square influence. Placed influence is hidden unless selected, overlay-active, placing, or relocating; placement uses the complete authoritative square, radius, side length, and active-cell boundary. Layer disposal clears its maps and child nodes; final scene disposal releases the shared materials and remaining Babylon resources.

## Browser research and district placement

The Research drawer exposes the Services Core card with exact requirement progress, missing requirements, the 50 Data cost, and a required tier-1 focus selection. After purchase it shows the installed Core and selected focus; rank-1 upgrade cards are intentionally absent. The Build drawer reveals Services only after the authoritative Core state unlocks it.

## Browser district placement

The Build drawer exposes the unlocked Living, Working, and Services seed kinds. Base costs are Living 10, Working 12, and Services 20 Data; the simulation charges `ceil(baseCost × 1.25^activeSameTypeCount)` and exposes the current count-based price to the UI. The game shell reads the simulation-owned definition and current-placement-info APIs; it does not duplicate radius, side length, Data, occupancy, ROW, lock, or active-chunk rules. Selecting a kind enters placement mode without spending. Hover previews are transient axis-aligned squares anchored at the candidate cell, a click/tap locks a candidate, and only the explicit `Place <Type> for <Cost> Data` button submits the authoritative command. Confirmation revalidates and is mutation-free on rejection. Accepted and rejected command results update an `aria-live` status, while the renderer immediately reconciles the detached snapshot and projects the seed.

Pointer picking is renderer-owned. Babylon picks only visible active-chunk ground meshes, then centralized coordinate helpers convert the picked world position to a logical cell and signed chunk using floor-based conversion. The renderer owns one reusable valid/invalid placement preview mesh plus bounded influence line resources. The game shell tracks one primary pointer with capture and an 8 CSS pixel drag threshold; only a matching non-drag release locks a candidate, and the confirmation button submits it. Touch uses the same pointer event path, and cancellation, lost capture, Build close, reset, and explicit cancel clear the gesture and preview without touching simulation state.

Renderer structural counters expose visible/rendered chunks, visible/rendered citizens, chunk rebuilds, and mesh count for bounded-resource tests. Ground continues to reconcile by stable chunk key and explicit occupancy/static-topology revisions, while entity layers reconcile by authoritative entity ID.

## Snapshots and balance runner

Snapshots scale with active chunk metadata and active entities, not coordinate extent. They contain no inactive chunks, empty bounding-box cells, or ordinary full demand fields. Detailed demand payloads are bounded and opt-in.

The headless balance runner reports active/allocated chunks, optional occupancy, demand, and ROW buffers, ROW/static-topology revisions, demand dirty/evaluation counts, path nodes expanded, path chunks touched, bounded traffic edge summaries and counters, construction offers/acceptances, construction commutes and arrivals, labor units, paused ticks, phase completions, worker releases, Services Core purchases, work/service activity and Data-source counters, incremental developer job progress, per-tick budget peaks, snapshot chunk summaries, invariant failures, and a determinism hash. Structural scenarios exercise sparse outward activation, coordinate extent beyond `1000 × 1000` without filling the box, localized demand dirtying, long multi-chunk routes, repeated traffic corridors, seed boundaries, same-type pricing, sparse local development, connected ROW, narrow connector budgets, dense circulation, supersession, long incremental jobs, one-worker and full-staff construction, corridor competition, staging queues, blocked-worker replanning, labor starvation, cap reduction, dense construction commute, off-screen projects, repeated deterministic construction, Services Core progression, service shortage, nearby and competing Services destinations, capacity bottlenecks, service-seed development, and dense service commutes.

## Deferred systems

This step intentionally does not add rank-1 research effects, apartments, mixed-use buildings, congestion costs, player-facing Traffic Analysis, paved roads, transit, chunk removal, ROW removal, player-facing expansion controls, polygon footprints, detailed voxel meshing, demolition, conversion, redevelopment, construction bots, a Travel Flow overlay, or traffic-dependent routing. The next focused task is limited to tier-1 research effects.
