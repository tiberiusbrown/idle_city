# Idle City — Design and Architecture

## 1. Document Authority

This document defines the approved target design and architecture for Idle City.

It serves as the authoritative contract for:

* Gameplay mechanics
* Simulation behavior
* Balance defaults
* State ownership
* Determinism requirements
* Rendering boundaries
* Testing invariants
* Incremental implementation work

The current repository is being migrated toward this design. During the migration, current code may disagree with this document.

Rules for interpreting this document:

1. This document defines the target state.
2. The current branch defines what is presently implemented.
3. Coding agents must implement only the explicitly assigned migration step.
4. Agents must not attempt to reconcile the entire repository with this document in one change.
5. Agents must not invent omitted mechanics.
6. Determinism, stable ordering, and mutation-free rejection are gameplay requirements, not optional implementation details.
7. Balance values in this document are authoritative defaults and must be centralized rather than duplicated as scattered literals.
8. Any deliberate deviation from this document must update the document as part of the same design change.
9. Rendering, browser timing, and machine performance must never affect authoritative outcomes.
10. Features listed as out of scope must not be preserved merely because they exist in the old implementation.

---

## 2. Game Concept

Idle City is a browser-first incremental city simulation about creating broad development zones and watching a virtual population organize itself.

The player does not place individual buildings or assign individual citizens.

The player:

1. Earns Data.
2. Purchases and places broad zones.
3. Watches autonomous planners select building sites.
4. Watches citizens construct buildings.
5. Gains population through available housing.
6. Watches citizens receive homes and jobs.
7. Earns more Data from citizen work trips.
8. Builds leisure capacity that temporarily improves productivity.
9. Repeats the loop at increasing scale.

The central fantasy is:

> Define where the city may grow, then watch its citizens build and inhabit it.

The city should remain visually active between player decisions. Citizens wander, commute, construct buildings, visit leisure destinations, and reorganize their assignments as new capacity becomes available.

---

## 3. Core Gameplay Loop

The initial core gameplay loop is:

1. The player places a Living zone and a Working zone.
2. Autonomous planning creates an incomplete building inside one eligible zone.
3. Citizens travel to the incomplete building and contribute construction labor.
4. Completed homes provide population capacity.
5. Completed workplaces provide work assignments.
6. Citizens with both assignments commute between home and work.
7. Entering a workplace produces Data.
8. Data purchases additional zones.
9. Leisure zones eventually create leisure buildings.
10. Leisure visits temporarily double Data produced by work visits.
11. Additional capacity generates more citizens and expands the loop.

The game must remain functional without:

* Manual citizen assignment
* Manual building placement
* Player-built roads
* Research upgrades
* Prestige systems
* Specialization systems
* Demand overlays
* City-wide performance indicators

---

## 4. Current Scope

### 4.1 Included systems

The target core includes:

* Infinite signed grid coordinates
* Chunked world storage
* Living, Working, and Leisure zones
* Autonomous building planning
* Incomplete and completed buildings
* Citizen construction labor
* Home and work assignments
* Population growth
* Citizen wandering
* Home-to-work commuting
* Leisure visits
* Data production
* Deterministic A* pathfinding
* Fixed-point citizen movement
* Local citizen collision handling
* Tick slicing across multiple calls or render frames
* Zone removal
* Snapshot-driven rendering
* Headless deterministic simulation testing

### 4.2 Explicitly out of scope

The following concepts are not part of the target core and must not be implemented unless this document is deliberately revised:

* District seeds
* Spatial demand fields
* Space, Access, or Activity indicators
* Services Core
* Research tracks
* Specialization
* Prestige
* Recompilation
* Metaprogression
* Learning districts
* Industry districts
* Entertainment districts
* Service needs
* Traffic-analysis progression
* Roads
* Transit
* Congestion-based long-range route costs
* Building redevelopment
* Individual building demolition
* Manual building approval
* Manual citizen assignment
* Citizen statistics beyond those required by this loop
* Multiplayer
* Backend simulation
* Save compatibility with pre-migration builds

Traffic instrumentation may be retained internally when useful for debugging, but it must not affect gameplay or routing in the core design.

---

## 5. Repository Architecture

The intended package dependency direction is:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

Reverse dependencies are prohibited unless the architecture is deliberately revised.

### 5.1 `packages/shared`

`packages/shared` contains small, engine-independent primitives that are genuinely shared by multiple packages.

Examples include:

* Integer grid coordinates
* Chunk coordinates
* Grid rectangles
* Stable comparison helpers
* Stable hash primitives
* General fixed-point primitives

It must not become a miscellaneous utility package.

### 5.2 `packages/simulation`

`packages/simulation` owns all authoritative state and behavior.

It must:

* Run under Node without a browser
* Import no Babylon.js modules
* Use no DOM APIs
* Use no browser timing APIs
* Avoid `Math.random()`
* Own explicit deterministic randomness
* Own stable entity IDs
* Own command validation
* Own all zone, building, citizen, movement, and economy rules
* Advance only through explicit logical simulation work
* Expose detached serializable snapshots
* Keep observation mutation-free
* Remain usable by the balance runner

### 5.3 `packages/renderer`

`packages/renderer` is a downstream projection of completed simulation snapshots.

It may own:

* Babylon.js scenes
* Meshes
* Instances
* Materials
* Camera state
* Renderer-only animation
* Interpolation
* Renderer-only caches
* Visibility selection
* Chunk or multi-chunk mesh batching

It must not:

* Decide authoritative behavior
* Generate authoritative IDs
* Change citizen goals
* Change building placement
* Change citizen positions
* Mutate simulation snapshots
* Make simulation outcomes frame-rate dependent
* Treat Babylon transforms as authoritative logical state

### 5.4 `apps/game`

`apps/game` owns:

* Browser startup
* DOM controls
* Player input
* Zone placement interaction
* Zone removal interaction
* Pause and speed controls
* Timing and work-budget orchestration
* Command submission
* PWA registration
* Passing completed snapshots to the renderer

Substantial simulation rules must not live in the browser application.

### 5.5 `tools/balance-runner`

The balance runner executes the same simulation under Node.

It must:

* Import no Babylon.js modules
* Accept explicit seeds and scenario parameters
* Advance the simulation deterministically
* Support different tick-work budgets
* Produce machine-readable output
* Report invariant violations
* Support long-run economy and gridlock scenarios
* Produce stable hashes for repeated identical runs

---

## 6. Determinism

The complete authoritative outcome must be determined by:

* Initial configuration
* World seed
* Ordered accepted player commands
* Logical tick number

The outcome must not depend on:

* Render frame rate
* Wall-clock timing
* CPU speed
* Number of simulation calls used to complete a tick
* Snapshot observation frequency
* Array insertion order where a stable ordering is required
* Browser or renderer state

### 6.1 Randomness

All authoritative randomness must be explicit and deterministic.

The simulation must not use `Math.random()`.

Random decisions should use one of two models:

1. A stored seeded random generator whose consumption order is explicitly stable.
2. Keyed deterministic randomness derived from values such as:

```text
world seed
logical tick
entity ID
decision kind
attempt index
```

Keyed randomness is preferred for local decisions whose result should not change merely because an unrelated subsystem consumed an additional random value.

Examples include:

* Selecting a building-interior destination cell
* Selecting a wandering destination
* Choosing among equivalent sidestep cells
* Population growth rolls
* Building-planning rolls
* Building transform ordering
* Zone selection

### 6.2 Stable ordering

Every authoritative iteration with potentially ambiguous results must define stable ordering or deterministic tie-breaking.

Stable ordering is required for:

* Zones
* Buildings
* Citizens
* Projects
* Candidate construction workers
* Candidate assignments
* Pathfinding neighbors
* Building transforms
* Planning anchors
* Movement proposals
* Movement conflicts
* Snapshot arrays
* Command application

Stable entity IDs are the final tie-breaker unless a more specific rule is stated.

### 6.3 Mutation-free rejection

Rejected commands must not change:

* Data
* Zones
* Buildings
* Citizens
* Projects
* Routes
* Assignment reservations
* Entity ID counters
* Random state
* Tick state
* Structural counters
* Completed snapshots
* Determinism hashes

---

## 7. Logical Time and Tick Slicing

The simulation advances through fixed logical ticks.

The default target speed is:

```text
5 logical ticks per second
```

Rendering runs independently through `requestAnimationFrame`.

### 7.1 Transactional ticks

A logical tick is transactional.

A tick may require multiple calls to complete, but partial tick state is private to the simulation.

During an incomplete tick:

* The renderer continues using completed snapshots.
* The tick number has not yet advanced.
* A new completed snapshot is not exposed.
* Observation must not change the pending work.
* Player commands are queued for a defined tick boundary.
* The simulation may retain private cursors, proposals, jobs, and temporary buffers.

The tick commits only after all required stages complete.

### 7.2 Work-unit API

The simulation should expose a bounded work interface conceptually equivalent to:

```ts
interface TickWorkResult {
  readonly status: "in-progress" | "committed";
  readonly stage: TickStage;
  readonly workUnitsConsumed: number;
}

interface Simulation {
  advanceTickWork(maxWorkUnits: number): TickWorkResult;
}
```

The exact API may evolve, but these contracts are mandatory:

* The caller supplies a deterministic work-unit budget.
* The simulation never receives a millisecond budget.
* The browser may use elapsed time to decide how many times to invoke the method.
* Each simulation call advances a stable amount of authoritative work.
* Different work-unit budgets must produce the same completed state.

The following runs must produce identical completed snapshots and hashes:

```text
same initial state
same world seed
same accepted commands
same number of completed ticks
different work-unit budgets
different calls per render frame
```

### 7.3 Completed snapshots

The simulation retains at least the two latest completed snapshots needed for renderer interpolation.

Rendering must never inspect a partially computed tick.

If the simulation cannot complete ticks quickly enough, the logical tick rate may fall below its target. The simulation must not skip required work or alter results to keep up with rendering.

### 7.4 Tick stages

The target authoritative tick order is:

1. Apply queued commands for the tick.
2. Apply zone removals and invalidate removed references.
3. Freeze start-of-tick citizen occupancy.
4. Decrement activity and leisure-cooldown timers.
5. Complete activities whose timers expired.
6. Mark citizens requiring a new goal.
7. Fill available construction assignments.
8. Select non-construction goals.
9. Advance bounded path-planning work.
10. Accrue fixed-point movement credit.
11. Generate movement proposals.
12. Resolve movement conflicts and dependencies.
13. Commit accepted movement simultaneously.
14. Process arrivals.
15. Start building activities.
16. Produce Data for workplace entries.
17. Apply construction labor.
18. Complete buildings that reached their labor requirement.
19. Apply home and work assignment changes caused by completion.
20. Evaluate population growth.
21. Advance building-planning work.
22. Commit the completed tick and snapshot.

Individual stages may be internally divided into resumable jobs.

A citizen or building must not be processed twice in the same stage because a tick was split across multiple calls.

---

## 8. World Coordinates and Chunks

### 8.1 Logical grid

The world uses signed integer two-dimensional grid coordinates.

```ts
interface GridPosition {
  readonly x: number;
  readonly y: number;
}
```

Citizens occupy individual grid cells.

Buildings and zones occupy sets of grid cells.

Movement is orthogonal:

* North
* East
* South
* West

Diagonal movement is not used.

### 8.2 Chunks

The logical world is divided into square chunks.

The initial default chunk size is:

```text
32 × 32 logical cells
```

Chunk size is centralized and may be adjusted at compile or configuration time for performance testing.

Chunks are an internal storage and rendering concept.

They must not:

* Be visibly outlined during normal play
* Restrict zone placement
* Affect building-planning rules
* Affect pathfinding semantics at boundaries
* Affect zone cost
* Affect citizen decisions

Negative coordinates must use floor-based chunk conversion so that chunk boundaries are stable on both sides of zero.

### 8.3 Lazy allocation

World storage must scale with used space rather than coordinate extent.

Placing a zone may lazily allocate all chunks intersected by that zone.

Additional spatial buffers should remain lazy where practical.

The simulation must not preallocate a maximum world rectangle.

---

## 9. Zones

### 9.1 Zone types

The core contains exactly three zone types:

```ts
type ZoneType = "living" | "working" | "leisure";
```

A zone permits only buildings associated with its own type.

### 9.2 Zone geometry

Zones are axis-aligned cell rectangles.

Each zone has:

* Stable ID
* Type
* World-space rectangle
* Placement tick
* Planning state
* Saturation state where applicable

Zones:

* May cross chunk boundaries
* May contain citizens
* May not overlap other zones
* May not rotate
* May not change size after placement
* Lazily allocate their affected chunks
* Remain visible while active

### 9.3 Zone placement

The player directly places zones.

A placement command must specify:

* Zone type
* Zone origin or rectangle
* Expected current cost where needed for stale-command protection

The simulation validates:

* The zone type is valid.
* The rectangle matches the authoritative dimensions for that zone type.
* Coordinates are safe integers.
* The zone does not overlap another active zone.
* The player has enough Data.
* No other explicit placement restriction fails.

Citizens do not block zone placement.

A successful placement:

* Deducts Data exactly once.
* Creates one stable zone ID.
* Allocates intersected chunks as needed.
* Makes the zone eligible for an immediate building-planning opportunity.
* Updates the cost of the next zone of the same type.

### 9.4 Zone removal

The player may remove an existing zone.

Zone removal:

* Gives no Data refund.
* Removes every incomplete building in the zone.
* Removes every completed building in the zone.
* Releases every construction assignment in the zone.
* Removes every building assignment referencing the removed buildings.
* Cancels routes targeting removed buildings.
* Cancels leisure reservations targeting removed buildings.
* Leaves citizens at their current logical positions.
* Makes removed building footprints ordinary open land.
* Recalculates the next zone cost using the reduced active same-type zone count.

A citizen finishing an activity in a building removed by the same command does not continue that activity. Removal invalidates the building immediately at the command boundary.

Removing a zone does not remove its chunks merely because they become empty. Chunk deallocation is an implementation optimization and must not affect gameplay.

### 9.5 Zone cost

The cost of the next zone of a type is:

```text
zone_cost(type) =
    ceil(base_cost(type) × 1.25 ^ active_same_type_zone_count)
```

The first zone uses exponent `0`.

Only active zones of the same type affect the exponent.

Removing a zone lowers future same-type costs because the active zone count decreases.

There is no removal refund.

---

## 10. Buildings

### 10.1 Building types

The core contains one initial building archetype per zone type:

* Single House
* Small Shop
* Small Park

Additional archetypes may be added only through an intentional design revision.

### 10.2 Archetypes and instances

Static building definitions should be separated from dynamic building instances.

A building archetype defines:

* Stable archetype ID
* Compatible zone type
* Physical footprint
* Exclusion shape
* Assignment capacity
* Construction-worker capacity
* Required labor
* Supported transformations
* Renderer visual kind

A building instance defines:

* Stable building ID
* Owning zone ID
* Archetype ID
* Origin
* Transform
* Physical footprint cells
* Exclusion-shape cells
* Completion state
* Labor completed
* Assigned construction-worker IDs
* Permanent citizen assignments where applicable
* Temporary destination reservations where applicable

### 10.3 Physical footprint

The physical footprint is the set of grid cells physically occupied by the building.

It is used for:

* Rendering
* Building-interior citizen movement
* Static navigation blocking
* Placement validation
* Construction presence
* Arrival detection

A completed or incomplete physical footprint is blocked to ordinary world navigation except when it is the citizen’s current route source or route destination.

### 10.4 Exclusion shape

The exclusion shape is a placement-only region around the physical footprint.

Its purpose is to prevent physical buildings from being placed immediately adjacent to one another.

Exclusion-shape cells:

* Do not block citizen movement by themselves
* Do not need to be visually rendered
* Must fit entirely inside the owning zone
* May overlap another building’s exclusion shape
* May contain citizens

Placement relationships are symmetric:

* A candidate physical footprint may not overlap an existing physical footprint.
* A candidate physical footprint may not overlap an existing exclusion shape.
* A candidate exclusion shape may not overlap an existing physical footprint.
* A candidate exclusion shape may overlap another exclusion shape.

Incomplete buildings participate in these rules exactly like completed buildings.

### 10.5 Transformations

Buildings may be:

* Rotated
* Reflected
* Rotated and reflected

Only unique transformed shapes should be considered.

Transform enumeration must be stable.

For rectangular archetypes whose transformations produce identical geometry, duplicate transformations must not create duplicate planning candidates.

### 10.6 Building states

A building is either:

```ts
type BuildingState =
  | {
      readonly kind: "incomplete";
      readonly laborCompleted: number;
      readonly laborRequired: number;
    }
  | {
      readonly kind: "complete";
    };
```

An incomplete building exists authoritatively from the moment its site is accepted.

It immediately reserves:

* Its physical footprint
* Its exclusion relationships
* Its construction-worker capacity

An incomplete building becomes complete when its accumulated labor reaches its required labor.

Completion occurs at the building-completion stage of the current logical tick.

The building becomes available for ordinary citizen goals beginning with subsequent goal selection.

---

## 11. Citizen State

Each citizen has:

* Stable citizen ID
* Current grid position
* Previous completed-tick position
* Fixed-point movement credit
* Movement speed
* Current goal
* Current path
* Path index
* Blocked-movement count
* Home assignment or `null`
* Work assignment or `null`
* Construction assignment or `null`
* Leisure destination reservation or `null`
* Leisure cooldown ticks remaining
* Current building activity
* Activity ticks remaining
* Wandering anchor
* Wandering target
* Relevant deterministic recovery state

Home and work assignments are persistent relationships.

Construction and leisure destinations are temporary goal-related reservations.

### 11.1 Assignment capacities

Building capacities have distinct meanings:

* A house has resident-assignment capacity.
* A shop has worker-assignment capacity.
* A park has temporary visitor-reservation capacity.
* An incomplete building has construction-worker assignment capacity.

These capacities must not be conflated.

A citizen may simultaneously have:

* One home assignment
* One work assignment
* One construction assignment

A construction assignment does not release the citizen’s home or work assignment.

---

## 12. Citizen Goals

A citizen tracks one active goal.

The goal priority is:

1. Construct an incomplete building.
2. Visit a leisure building.
3. Produce Data through home/work activity.
4. Wander.

Citizens normally select a new goal only after finishing their current activity or trip.

Newly available construction work does not interrupt an active:

* Home trip
* Home stay
* Work trip
* Work stay
* Leisure trip
* Leisure stay

The citizen checks for construction opportunities when it next requires a goal.

A construction assignment, once accepted, remains active until:

* The building completes
* The owning zone is removed
* The project is otherwise invalidated by an authoritative command

### 12.1 Construction goal selection

When an incomplete building has an open construction-worker slot, candidate citizens are selected in two groups.

First preference:

* Citizens not already assigned to construction
* Citizens missing a home assignment or work assignment
* Citizens able to reach the project

If no preferred candidate is available, the project may consider:

* Any citizen not already assigned to construction
* Any citizen able to reach the project

Citizens who already have both home and work assignments may not be newly assigned when at least 50% of all citizens are currently assigned to construction.

The 50% rule protects productive citizens. It does not prevent citizens missing a home or work assignment from taking construction work.

Candidates are ranked by:

1. Preferred incomplete-assignment group before fully assigned citizens.
2. Lower Manhattan distance to the building physical footprint.
3. Lower stable citizen ID.

A project slot is reserved immediately when the assignment is accepted.

Citizens traveling to construction count as assigned construction workers.

### 12.2 Construction behavior

An assigned construction worker:

1. Navigates to a deterministic destination cell inside the incomplete building’s physical footprint.
2. Enters the footprint.
3. Remains within the footprint until completion.
4. Wanders inside the footprint using ordinary movement rules.
5. Contributes one labor unit per logical tick while inside the footprint.

Construction labor does not depend on whether the worker successfully moved within the footprint during that tick.

A worker contributes no construction labor while still traveling.

Each worker contributes at most one labor unit per tick.

### 12.3 Leisure goal selection

A citizen may select leisure when:

* The citizen is not assigned to construction.
* The citizen is not on leisure cooldown.
* At least one completed leisure building is reachable.
* At least one reachable leisure building has an unreserved visitor slot.

Leisure capacity includes:

* Citizens currently inside the building
* Citizens traveling to the building
* Citizens holding an accepted leisure reservation before route completion

The reservation is created when the leisure goal is accepted.

The reservation is released when:

* The leisure visit completes
* The destination zone is removed
* The leisure goal is invalidated
* The citizen is removed

Destination choice should prefer a reachable building with available capacity and use deterministic tie-breaking.

The initial rule is:

1. Shorter path length.
2. Lower occupancy ratio.
3. Lower stable building ID.

### 12.4 Data-production goal

A citizen can produce Data when it has both:

* A completed home assignment
* A completed work assignment

The citizen alternates:

```text
home stay
travel to work
work entry and Data production
work stay
travel home
home stay
repeat
```

Data is produced when the citizen enters its assigned workplace.

The activity timers begin after arrival. The arrival tick does not also consume the first full stay tick.

### 12.5 Wandering goal

A citizen wanders when it is not:

* Assigned to construction
* Visiting leisure
* Able to perform the home/work loop

When a citizen begins a wandering episode, it records its current position as the wandering anchor.

The citizen must remain within Chebyshev distance 16 of that anchor:

```text
max(abs(x - anchorX), abs(y - anchorY)) <= 16
```

Wandering uses finite wandering segments:

1. Select a deterministic random reachable target within the allowed area.
2. Navigate to it.
3. On arrival, check higher-priority goals.
4. If no higher-priority goal exists, select another wandering target.

This ensures that wandering citizens regularly reconsider construction and newly available assignments.

---

## 13. Assignments and Reassignments

### 13.1 General rules

Assignments may reference only completed buildings of the compatible type.

A home assignment must reference a completed Living building.

A work assignment must reference a completed Working building.

Assignment counts must never exceed building assignment capacity.

Assignment changes do not interrupt the citizen’s current non-construction trip or building activity.

A citizen may finish:

* Its current trip to an old assignment
* Its current stay in an old assignment
* Its current leisure visit

The new assignment is used when the citizen next selects a home/work destination.

Temporary presence in a former home or workplace does not continue consuming an assignment slot there.

### 13.2 Home completion

When a new Living building completes:

1. Assign citizens with no home.
2. If capacity remains, consider commute-improving reassignment.

Homeless citizens are ranked by:

1. Citizens with a work assignment before citizens without one.
2. Lower distance from the new home to the assigned workplace, when present.
3. Lower citizen ID.

For commute improvement:

1. Find the ten closest completed Working buildings to the new home.
2. Gather citizens assigned to those workplaces.
3. Exclude citizens with no current home.
4. Calculate the old and new commute distances.
5. Keep only citizens whose new commute is strictly shorter.
6. Rank eligible citizens by:

   * Greater commute-distance reduction
   * Greater old commute distance
   * Lower citizen ID
7. Reassign until the new home is full.

### 13.3 Workplace completion

When a new Working building completes:

1. Assign citizens with no work assignment.
2. If capacity remains, consider commute-improving reassignment.

Citizens without work are ranked by:

1. Citizens with a home assignment before citizens without one.
2. Lower distance from the assigned home to the new workplace, when present.
3. Lower citizen ID.

For commute improvement:

1. Find the ten closest completed Living buildings to the new workplace.
2. Gather citizens assigned to those homes.
3. Exclude citizens with no current workplace.
4. Calculate the old and new commute distances.
5. Keep only citizens whose new commute is strictly shorter.
6. Rank eligible citizens by:

   * Greater commute-distance reduction
   * Greater old commute distance
   * Lower citizen ID
7. Reassign until the workplace is full.

### 13.4 Building distance

Building-to-building Manhattan distance is the minimum Manhattan distance between any cell in the first physical footprint and any cell in the second physical footprint.

This definition must be used consistently for:

* Reassignment ranking
* Nearest-building selection
* Construction-candidate distance where a route length is not used

Path length remains authoritative for actual travel when a path has been computed.

---

## 14. Navigation

### 14.1 A* pathfinding

Citizens use deterministic A* pathfinding over orthogonally adjacent logical cells.

A* must define:

* Stable neighbor order
* Stable open-set tie-breaking
* Integer movement costs
* Explicit no-path status
* Explicit bounded-work or node-expansion behavior
* Resumable search when required by tick slicing

The initial canonical neighbor order is:

```text
North
East
South
West
```

Equivalent shortest paths use stable coordinate and insertion-sequence tie-breaking.

### 14.2 Building passability

All physical building footprints are blocked to ordinary navigation except:

* The citizen’s current route source building
* The citizen’s current route destination building

An incomplete building footprint is passable only to citizens assigned to construct that building.

An unrelated building may not be used as a shortcut.

A citizen inside a source building may path outward through that building’s footprint.

A citizen approaching a destination building may path into the chosen destination cell inside that building’s footprint.

### 14.3 Destination cells

When traveling to a building, the citizen selects a deterministic random destination cell within the building’s physical footprint.

The selection key should include:

```text
world seed
citizen ID
building ID
goal instance or trip sequence
decision kind
```

A citizen is considered inside the building whenever its current cell lies within the physical footprint.

### 14.4 Route lifetime

A path is normally calculated once per trip.

A route may be invalidated when:

* Its destination building is removed.
* A newly planned physical footprint blocks a future route cell.
* The citizen performs a sidestep.
* The citizen reaches a defined deadlock-recovery threshold.
* The route is otherwise found to be invalid.

Other citizens are not treated as permanent A* obstacles during ordinary route planning.

---

## 15. Fixed-Point Movement

### 15.1 Fixed-point scale

Authoritative citizen speed uses fixed-point units.

The initial scale is:

```text
1024 movement units = 1 logical cell
```

The initial citizen speed is:

```text
512 movement units per tick
```

This represents:

```text
0.5 cells per tick
```

### 15.2 Movement credit

At the movement-credit stage:

```text
movementCredit =
    min(1024, movementCredit + movementSpeed)
```

A citizen may propose one adjacent move when its movement credit is at least 1024.

A successful move consumes 1024 movement credit.

A blocked move does not consume movement credit.

Credit is capped at one cell so that blocked citizens cannot accumulate multiple future moves and temporarily exceed their intended speed.

Each citizen moves by at most one cell in one logical tick.

---

## 16. Citizen Movement Resolution

Citizen movement uses:

```text
proposal
resolution
simultaneous commit
```

Citizen positions must not be sequentially mutated while proposals are still being generated.

### 16.1 Proposal generation

Proposals are generated against start-of-tick occupancy.

Each eligible citizen proposes at most one adjacent target cell.

Proposal generation may be spread across multiple work calls, but all proposals must use the same frozen occupancy state.

### 16.2 Target conflicts

When multiple citizens propose the same target, priority is:

1. Greater blocked-movement count.
2. Fewer remaining path cells.
3. Earlier goal or trip start tick.
4. Lower citizen ID.

Only one proposal may win an ordinary target conflict.

### 16.3 Dependency chains

A citizen may move into a currently occupied cell when the occupant has an accepted move that vacates the cell during the same commit.

Movement dependencies must be resolved before commit.

### 16.4 Swaps and cycles

Direct two-citizen swaps are allowed when:

* Each citizen proposes the other citizen’s current cell.
* Both citizens have enough movement credit.
* Both destination cells are legal for the respective citizens.
* Neither proposal violates another authoritative restriction.

Movement cycles of three or more citizens are also allowed.

Any valid closed dependency cycle may rotate simultaneously.

Allowing all valid cycles is required to reduce unnecessary gridlock.

### 16.5 Blocked movement

A citizen whose proposal is rejected:

* Remains in place.
* Retains movement credit.
* Increments its blocked-movement count.

A citizen whose move commits:

* Updates its position.
* Consumes movement credit.
* Resets its blocked-movement count.
* Advances its path index where applicable.

### 16.6 Sidestep recovery

After four consecutive blocked movement opportunities, a citizen may attempt a deterministic sidestep.

The sidestep:

* Considers orthogonally adjacent cells.
* Requires the candidate cell to be statically legal.
* Requires the candidate cell to be open under movement reservations.
* Must remain inside the current building footprint when the citizen is performing internal movement.
* Must not enter an unrelated building footprint.
* Uses keyed deterministic randomness to order equivalent candidates.
* Commits through the same proposal-resolution system.
* Invalidates and replans the original route after the sidestep successfully commits.

A failed sidestep leaves the original route unchanged.

### 16.7 Extended deadlock recovery

Complete and permanent gridlock is prohibited.

After eight consecutive blocked movement opportunities, the citizen attempts a bounded route replan that may treat current citizen occupancy as temporary local obstacles or penalties.

After twelve consecutive blocked movement opportunities, deterministic emergency recovery may authorize an otherwise legal atomic swap with the blocking citizen even when the blocker was not independently proposing the reverse move.

Emergency recovery must not:

* Enter a statically invalid cell
* Enter an unrelated building
* Move more than one cell
* Teleport a citizen
* Change the citizen’s goal
* Consume nondeterministic randomness

### 16.8 Global liveness requirement

The movement system must satisfy this liveness contract:

> In a connected walkable region containing either an available legal cell or a valid occupancy cycle, movement-ready citizens must not remain permanently unable to move.

A global no-progress watchdog must detect consecutive ticks in which:

* At least one citizen is movement-ready, and
* No citizen movement commits.

After sixteen such ticks, the resolver must perform deterministic bounded recovery by selecting the highest-waiting citizen and resolving a valid sidestep, swap, dependency-chain move, or occupancy-cycle rotation.

The implementation may evolve, but total gridlock must remain impossible under the stated reachable-space condition.

Adversarial gridlock scenarios must be included in automated tests.

---

## 17. Internal Building Movement

Citizens inside a building wander randomly within its physical footprint while performing an activity.

Internal movement:

* Uses the same fixed-point movement credit.
* Uses the same proposal-resolution-commit system.
* Is constrained to cells in the current building footprint.
* Respects other citizens inside the same building.
* Does not change the current goal.
* Does not affect activity duration.
* Does not affect construction labor.

A citizen may remain stationary when no internal move is available.

Internal movement targets use keyed deterministic randomness.

---

## 18. Building Planning

### 18.1 Planning purpose

Buildings are not manually placed by the player.

Building planning autonomously creates incomplete buildings inside compatible zones.

### 18.2 Eligibility

A new building-planning job may not begin when:

```text
citizens assigned to construction / total citizens >= 0.25
```

When population is zero, the construction-assignment ratio is treated as zero.

The 25% threshold prevents the planner from creating excessive construction backlog.

It does not limit the number of workers that an already planned project may recruit.

The separate 50% construction rule protects fully assigned productive citizens during recruitment.

### 18.3 Planning chance

Each eligible nonsaturated zone receives one deterministic planning roll per logical tick when no planning job is already active for that zone.

The initial chance is:

```text
planningChance =
    0.02 × zoneFreeSpaceRatio
```

The result is clamped to `[0, 0.02]`.

At a completely empty zone, this produces a 2% chance per tick.

At five ticks per second, a full empty zone receives a successful regular planning roll after approximately ten seconds on average.

A newly placed zone receives one immediate planning opportunity without waiting for a regular random roll.

### 18.4 Free-space ratio

The zone free-space ratio is:

```text
zone cells not covered by any active building exclusion shape
divided by total zone cells
```

Incomplete and completed buildings both count.

Exclusion-over-exclusion overlap is counted as covered space, but each cell contributes only once to the covered-cell count.

The ratio is clamped to `[0, 1]`.

### 18.5 Planning rolls

Planning rolls use keyed deterministic randomness based on:

```text
world seed
logical tick
zone ID
planning sequence
"building-planning-roll"
```

The result must not depend on:

* Zone array insertion order
* Number of sub-tick calls
* Renderer frame rate
* Work-unit budget

If multiple zones succeed during the same tick, at most one new world-level planning job begins.

Successful zones are ordered through deterministic keyed selection weighted by their free-space ratios, with zone ID as the final tie-breaker.

### 18.6 Incremental planning job

Building placement search is a resumable deterministic job.

The job records:

* Zone ID
* Archetype order
* Transform order
* Candidate-anchor order
* Current candidate cursor
* Valid candidates found
* Planning sequence
* Work consumed

Candidate checks may be distributed across multiple simulation calls or completed ticks where necessary.

The planning job must not expose partial candidate state to the renderer.

### 18.7 Candidate validation

A building candidate is valid only when:

* The archetype matches the zone type.
* Every physical-footprint cell lies inside the owning zone.
* Every exclusion-shape cell lies inside the owning zone.
* Its physical footprint overlaps no existing physical footprint.
* Its physical footprint overlaps no existing exclusion shape.
* Its exclusion shape overlaps no existing physical footprint.
* No citizen currently occupies a candidate physical-footprint cell.
* All physical cells are valid logical cells.
* At least one assigned worker could theoretically reach the site when active world topology is considered.
* No other explicit invariant fails.

Candidate exclusion shapes may overlap existing exclusion shapes.

### 18.8 Candidate ordering and selection

The order in which transforms and anchors are considered is deterministically randomized using:

```text
world seed
zone ID
planning sequence
archetype ID
decision kind
```

The result must be stable for the same authoritative state.

At most one incomplete building is created from one completed planning job.

### 18.9 Site acceptance

When a candidate is accepted:

* A stable building ID is created.
* The building begins incomplete with zero labor.
* Its physical footprint becomes blocked to unrelated navigation.
* Its placement relationships become authoritative.
* Existing routes crossing the new physical footprint are invalidated.
* The owning zone’s saturation state is updated.
* Construction slots become available at subsequent goal selection.

### 18.10 Saturation

If an exhaustive planning job finds no valid candidate for a zone and archetype combination, that combination may be marked saturated.

A saturated combination does not receive repeated full searches until relevant geometry changes.

Relevant changes include:

* Zone creation
* Zone removal
* Building removal through zone removal
* Archetype or balance changes
* Any future mechanic explicitly defined to free building space

Saturation is an optimization state and must be deterministic.

---

## 19. Population Growth

### 19.1 Population capacity

Only completed Living buildings contribute population capacity.

```text
C = total completed home assignment capacity
P = current total population
```

Incomplete homes do not contribute capacity.

Population growth is possible only when:

```text
C > P
```

### 19.2 Growth pressure

Population-growth pressure is:

```text
if P > 0:
    pressure = max(0, C / P - 1)
else if C > 0:
    pressure = 1
else:
    pressure = 0
```

This makes growth faster when available capacity is large relative to current population and slower as the population approaches capacity.

### 19.3 Growth chance

The initial chance per tick is:

```text
populationGrowthChance =
    min(0.10, 0.02 × pressure)
```

Examples:

| Population | Capacity | Pressure | Chance per tick |
| ---------: | -------: | -------: | --------------: |
|          4 |        5 |     0.25 |            0.5% |
|          4 |        6 |     0.50 |            1.0% |
|          4 |        8 |     1.00 |            2.0% |
|          1 |        6 |     5.00 |       10.0% cap |

At most one citizen may be generated in one logical tick.

### 19.4 Growth roll

The growth roll uses keyed deterministic randomness based on:

```text
world seed
logical tick
population count
completed home capacity
population-growth sequence
"population-growth-roll"
```

Changing the number of sub-tick calls must not affect the result.

### 19.5 Selecting a home

When growth succeeds:

1. Gather completed Living buildings with an unassigned resident slot.
2. Weight each building by its number of unassigned resident slots.
3. Select a home through keyed deterministic weighted choice.
4. Create a stable citizen ID.
5. Assign the citizen to the selected home.
6. Spawn the citizen in a deterministic cell inside that home’s physical footprint.
7. Attempt to assign an available workplace through ordinary assignment rules.
8. If no workplace is available, the citizen wanders after leaving or completing its initial home state.

Population growth does not require available work capacity.

Unemployed citizens are allowed and may contribute construction labor or wander until work becomes available.

---

## 20. Data and Activities

### 20.1 Data

Data is the only core currency.

Data:

* Is authoritative simulation state.
* Changes only through explicit commands or workplace entry.
* Must never become negative.
* Is represented using an exact integer for the current core design.
* Is independent of rendering.
* Is independent of wall-clock time.

### 20.2 Work production

A citizen produces base Data when entering its assigned completed workplace.

Base production is:

```text
1 Data per workplace entry
```

If the citizen’s leisure cooldown is greater than zero when the workplace arrival is processed:

```text
2 Data per workplace entry
```

Data is produced on entry, not after the work stay completes.

### 20.3 Building stay durations

After arriving inside a building, the citizen begins an activity.

Initial durations are:

* Home stay: 75 ticks
* Work stay: 50 ticks
* Leisure stay: 50 ticks

The arrival tick initializes the timer.

The timer begins decrementing during the next logical tick.

### 20.4 Leisure cooldown

When a leisure visit completes:

```text
leisureCooldownTicksRemaining = 1500
```

While cooldown is greater than zero:

* The citizen may not choose another leisure goal.
* Workplace entry produces double Data.

Cooldown is decremented during the timer stage at the start of a tick.

The doubled work-entry rule checks the post-decrement cooldown value during arrival processing.

A citizen with cooldown `1` at the beginning of the tick reaches `0` before movement and does not receive doubled Data from a workplace entry later in that tick.

---

## 21. World Rendering

### 21.1 Snapshot authority

The renderer consumes completed detached snapshots.

It must not access private partial-tick state.

Rendering interpolates between the two most recent completed citizen positions.

Interpolation never feeds back into simulation state.

### 21.2 Infinite-plane presentation

The renderer presents the world as a continuous plane.

Chunk boundaries are not visibly displayed during ordinary play.

Ground geometry may be stored as:

* One mesh per visible chunk
* One mesh per group of chunks
* Another bounded batching strategy

The chosen batching strategy is renderer-only.

### 21.3 Zone rendering

Zones are always visibly represented as light-colored ground regions with thick outlines.

Initial colors are:

* Living: green
* Working: blue
* Leisure: orange

Zone rendering must remain visible beneath or around buildings.

Overlapping zone visualization is unnecessary because zones may not overlap.

### 21.4 Building rendering

Initial visuals are:

* Single House:

  * Green
  * Two blocks high
* Small Shop:

  * Blue
  * Three blocks high
* Small Park:

  * Green ground
  * A small number of tree-like details

Incomplete buildings must visibly communicate construction progress.

Construction visuals may interpolate or animate between authoritative snapshots, but renderer animation must not create additional authoritative labor or phases.

### 21.5 Citizen rendering

Citizens are rendered from logical grid positions using centralized logical-to-world conversion.

Citizen interpolation uses:

* Previous completed-tick position
* Current completed-tick position
* Renderer-owned interpolation progress

The renderer may visually distinguish:

* Ordinary citizens
* Construction-assigned citizens
* Citizens on leisure cooldown

These distinctions are visual only.

### 21.6 Stable-ID reconciliation

Renderer layers reconcile by stable authoritative ID:

```text
snapshot-only ID -> create
shared ID        -> update
renderer-only ID -> dispose
```

Repeated rendering of an unchanged snapshot must not duplicate resources.

---

## 22. Player Interface

The core interface should expose:

* Current Data
* Current population
* Total home capacity
* Number of construction-assigned citizens
* Pause control
* Normal-speed control
* Fast-speed control
* Living-zone placement
* Working-zone placement
* Leisure-zone placement
* Current cost of each zone type
* Zone removal
* Basic building inspection
* Construction labor progress
* Building assignment capacity
* Citizen assignment inspection where useful

The normal interaction model is mouse- and touch-friendly.

The game must not require:

* Keyboard input
* Text entry
* Numeric steppers
* Manual citizen selection for assignment
* Manual building placement

Player commands are validated authoritatively by the simulation.

The UI may preview likely placement results, but it must not duplicate authoritative validation as the final source of truth.

---

## 23. Starting State

The default world starts with:

* Four citizens near `(0, 0)`
* 10 Data
* No zones
* No buildings
* No incomplete buildings
* No home assignments
* No work assignments
* No leisure cooldowns

The initial citizen cells are:

```text
(0, 0)
(1, 0)
(0, 1)
(1, 1)
```

If configuration or future world initialization makes one of these cells invalid, startup selects the nearest valid distinct cells in stable row-major order.

All four citizens initially wander.

The first Living zone costs 4 Data.

The first Working zone costs 6 Data.

The player can therefore purchase one initial Living zone and one initial Working zone with the starting 10 Data.

---

## 24. Initial Balance Values

### 24.1 Simulation

| Parameter                                      |            Initial value |
| ---------------------------------------------- | -----------------------: |
| Target tick rate                               |           5 ticks/second |
| Fixed-point units per cell                     |                     1024 |
| Citizen movement speed                         |           512 units/tick |
| Sidestep threshold                             |  4 blocked opportunities |
| Local replan threshold                         |  8 blocked opportunities |
| Emergency recovery threshold                   | 12 blocked opportunities |
| Global no-progress threshold                   |                 16 ticks |
| New-project construction ratio block           |                      25% |
| Fully assigned citizen construction protection |                      50% |
| Planning coefficient                           |                     0.02 |
| Population-growth coefficient                  |                     0.02 |
| Maximum population-growth chance               |             10% per tick |
| Wander radius                                  |       16 cells Chebyshev |

### 24.2 Data production

| Parameter                                 | Initial value |
| ----------------------------------------- | ------------: |
| Base Data per workplace entry             |             1 |
| Leisure-enhanced Data per workplace entry |             2 |
| Home stay                                 |      75 ticks |
| Work stay                                 |      50 ticks |
| Leisure stay                              |      50 ticks |
| Leisure cooldown                          |    1500 ticks |

### 24.3 Zones

| Zone          | Base cost |    Size |
| ------------- | --------: | ------: |
| Small Living  |    4 Data | 13 × 13 |
| Small Working |    6 Data | 13 × 13 |
| Small Leisure |   40 Data |   8 × 8 |

Zone-cost formula:

```text
ceil(base cost × 1.25 ^ active same-type zone count)
```

### 24.4 Single House

| Property                     |    Value |
| ---------------------------- | -------: |
| Zone type                    |   Living |
| Physical footprint           |    2 × 2 |
| Exclusion shape              |    4 × 4 |
| Resident capacity            |        1 |
| Construction-worker capacity |        1 |
| Required labor               |      100 |
| Visual height                | 2 blocks |

The exclusion shape extends one cell beyond the physical footprint on every side.

### 24.5 Small Shop

| Property                     |    Value |
| ---------------------------- | -------: |
| Zone type                    |  Working |
| Physical footprint           |    3 × 3 |
| Exclusion shape              |    5 × 5 |
| Worker capacity              |        4 |
| Construction-worker capacity |        2 |
| Required labor               |      300 |
| Visual height                | 3 blocks |

The exclusion shape extends one cell beyond the physical footprint on every side.

### 24.6 Small Park

| Property                     |                   Value |
| ---------------------------- | ----------------------: |
| Zone type                    |                 Leisure |
| Physical footprint           |                   6 × 6 |
| Exclusion shape              |                   8 × 8 |
| Visitor capacity             |                       5 |
| Construction-worker capacity |                       2 |
| Required labor               |                     600 |
| Visual form                  | Green ground with trees |

The exclusion shape extends one cell beyond the physical footprint on every side.

---

## 25. Authoritative Commands

Initial authoritative commands include:

```ts
placeZone(...)
removeZone(...)
```

Commands must:

* Be validated entirely inside the simulation
* Return structured accepted or rejected results
* Use centralized costs
* Use stable IDs
* Apply only at defined tick boundaries
* Be mutation-free when rejected
* Avoid consuming randomness when rejected

A generic command framework should not be introduced until multiple commands clearly benefit from one.

---

## 26. Snapshot Requirements

Ordinary completed snapshots should include enough detached state for:

* Rendering
* UI
* Balance analysis
* Invariant checks
* Stable hashing

Expected snapshot concepts include:

* Tick number
* Seed identity or deterministic random state
* Data
* Population
* Zone definitions and rectangles
* Building definitions and states
* Construction labor
* Building assignments
* Citizen positions
* Previous citizen positions
* Citizen goals or public activity state
* Home and work references
* Leisure cooldown
* Movement wait state where useful
* Planning-job summary
* Structural counters
* Invariant failures in headless scenarios

Private implementation buffers should not be exposed unless needed.

Snapshot reads must not:

* Advance work
* Consume randomness
* Change revisions
* Change counters
* Complete pending stages
* Alter hashes

---

## 27. Required Invariants

The simulation must continuously preserve these invariants.

### 27.1 Identity and references

* Every entity ID is unique.
* Every building references an existing zone.
* Every building archetype matches its zone type.
* Every home assignment references a completed Living building.
* Every work assignment references a completed Working building.
* Every construction assignment references an existing incomplete building.
* Every leisure reservation references an existing completed Leisure building.

### 27.2 Geometry

* Zones do not overlap.
* Every building physical footprint lies inside its zone.
* Every building exclusion shape lies inside its zone.
* Physical footprints do not overlap.
* A physical footprint does not overlap another building’s exclusion shape.
* An exclusion shape does not overlap another building’s physical footprint.
* Exclusion shapes may overlap one another.
* Citizens occupy valid logical cells.
* Citizens do not occupy unrelated building footprints.

### 27.3 Capacity

* Home assignment occupancy does not exceed resident capacity.
* Work assignment occupancy does not exceed worker capacity.
* Leisure reservations do not exceed visitor capacity.
* Construction assignments do not exceed construction-worker capacity.
* Population does not exceed completed home capacity after a completed population-growth transition.
* Zone removal may temporarily leave population greater than home capacity, but no invalid home assignments remain.

### 27.4 Movement

* Every committed move is orthogonally adjacent.
* A citizen moves at most once per tick.
* A citizen moves at most one cell per tick.
* Movement credit remains within `[0, 1024]`.
* A successful move consumes exactly 1024 credit.
* A blocked move consumes no credit.
* No two citizens end a movement commit in the same cell.
* Valid swaps and movement cycles commit atomically.
* Different proposal enumeration orders produce the same resolution.
* Permanent gridlock does not occur under the liveness conditions.

### 27.5 Economy and timers

* Data is a nonnegative integer.
* Labor is nonnegative.
* Labor completed does not exceed required labor for an incomplete building.
* Activity timers are nonnegative integers.
* Leisure cooldown is a nonnegative integer.
* Zone costs use active same-type zone count.
* Zone removal gives no refund.

### 27.6 Determinism

* Repeated identical scenarios produce identical snapshots.
* Repeated identical scenarios produce identical hashes.
* Different tick-work budgets produce identical committed results.
* Snapshot frequency does not affect outcomes.
* Renderer frame rate does not affect outcomes.
* Rejected commands do not mutate state.
* Rejected commands do not consume IDs or randomness.

---

## 28. Testing Strategy

### 28.1 Unit tests

Use focused tests for:

* Chunk conversion
* Negative coordinates
* Fixed-point movement
* Zone-cost formulas
* Zone placement
* Zone removal
* Footprint transforms
* Exclusion-shape validation
* Building-planning rolls
* Building-planning candidate order
* Construction-worker selection
* Assignment ranking
* Population-growth chance
* Population home selection
* Data production
* Leisure cooldown
* A* tie-breaking
* Source and destination building passability
* Movement target conflicts
* Swaps
* Three-or-more movement cycles
* Sidesteps
* Emergency recovery
* Mutation-free rejection
* Stable serialization
* Stable hashes

### 28.2 Simulation integration tests

Integration scenarios should verify:

* Initial four-citizen opening
* First Living and Working zone purchase
* Immediate planning opportunities
* House construction
* Shop construction
* First home/work assignments
* First Data production
* Population growth with spare housing
* Unemployed citizen wandering
* Later workplace assignment
* Leisure construction
* Leisure reservation capacity
* Leisure cooldown
* Doubled Data
* Zone removal
* Assignment loss after removal
* Cost reduction after removal
* Routes invalidated by new construction
* Citizens finishing current activity after reassignment
* Long-run progress
* No invalid references
* No capacity violations
* No permanent gridlock

### 28.3 Tick-slicing tests

Every major deterministic scenario should run with several work budgets, including:

```text
1 work unit
small uneven budget
medium budget
effectively unlimited budget
```

All runs must produce the same completed snapshot and hash after the same number of completed ticks.

### 28.4 Gridlock tests

Adversarial movement scenarios must include:

* Direct head-on pairs
* Three-citizen cycles
* Four-citizen cycles
* Narrow corridors
* Intersections
* Citizens leaving and entering buildings
* Multiple citizens targeting one cell
* Fully occupied local rings
* Blocked chains with one available escape cell
* Repeated opposing flows

Every scenario must demonstrate bounded progress.

### 28.5 Renderer tests

Use Babylon.js `NullEngine` where practical.

Test:

* Scene creation
* Scene disposal
* Zone rendering
* Building creation and removal
* Construction-progress updates
* Citizen interpolation
* Stable-ID reconciliation
* No duplicate resources
* Snapshot immutability
* Hidden chunk boundaries
* Cross-chunk zones

### 28.6 Browser tests

Use Playwright for:

* Startup
* No console errors
* Canvas creation
* Mouse zone placement
* Touch zone placement
* Invalid overlap rejection
* Zone-cost display
* Zone removal
* Pause
* Normal speed
* Fast speed
* Construction visibility
* Population growth
* Data growth
* Leisure behavior
* Reset
* Mobile viewport usability

Screenshot tests must not replace deterministic simulation tests.

---

## 29. Balance Runner Scenarios

The headless balance runner should eventually include named scenarios for:

* `opening`
* `living-first`
* `working-first`
* `first-data`
* `housing-surplus`
* `workplace-surplus`
* `population-growth`
* `construction-cap`
* `construction-protection`
* `zone-saturation`
* `zone-removal`
* `commute-reassignment`
* `leisure-loop`
* `cross-chunk-zone`
* `blocked-corridor`
* `movement-cycle`
* `gridlock-recovery`
* `long-run-core-loop`
* `work-budget-equivalence`

Machine-readable output should report at least:

* Completed ticks
* Data
* Population
* Home capacity
* Work capacity
* Zone counts by type
* Building counts by type and state
* Construction-worker count
* Labor contributed
* Completed buildings
* Work entries
* Leisure visits
* Population-growth attempts and successes
* Planning attempts and successes
* Pathfinding expansions
* Movement proposals
* Committed movements
* Blocked movements
* Sidesteps
* Replans
* Emergency recoveries
* Global no-progress recoveries
* Invariant failures
* Final stable hash

---

## 30. Migration Rules

The current repository contains systems that do not belong in this target design.

Migration must proceed through bounded steps.

Agents must:

* Inspect current code before changing it.
* Preserve tests unrelated to the assigned step where practical.
* Add transitional adapters only when explicitly useful.
* Avoid implementing later migration steps early.
* Avoid preserving obsolete behavior merely because it currently exists.
* Remove old concepts when the assigned migration step reaches them.
* Keep the simulation executable after each migration step.
* Keep deterministic headless validation working after each step.
* Update this document only for deliberate design changes, not implementation progress.

During migration, temporary coexistence is allowed between:

* Old and new APIs
* Old and new snapshot fields
* Old and new renderer layers
* Old and new scenario fixtures

Temporary coexistence must be narrowly scoped and removed in a later explicit step.

The migration should prioritize establishing the new authoritative model before polishing final rendering or UI.

---

## 31. Definition of the Core Milestone

The core gameplay milestone is complete when a fresh deterministic run can:

1. Start with four wandering citizens and 10 Data.
2. Place one Living zone and one Working zone.
3. Autonomously plan incomplete buildings.
4. Assign citizens to construction.
5. Complete at least one house and one shop.
6. Assign citizens to homes and work.
7. Produce Data through work entry.
8. Create additional population from spare completed home capacity.
9. Assign or later reassign new citizens to work.
10. Place and develop a Leisure zone.
11. Complete leisure visits.
12. Double qualifying workplace-entry Data during leisure cooldown.
13. Remove zones without refunds.
14. Recover from adversarial local movement congestion.
15. Produce identical results under different simulation work budgets.
16. Run headlessly for a long scenario without invariant failures.

Specialization, prestige, research, demand, advanced traffic, and other progression systems remain outside this milestone.
