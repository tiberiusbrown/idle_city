# AGENTS.md

## Purpose

This repository contains **Idle City**, a browser-first, installable 3D incremental city simulation.

The game uses:

* TypeScript
* Babylon.js
* Vite
* npm workspaces
* Vitest
* Playwright
* `vite-plugin-pwa`

The player places broad Living, Working, and Leisure zones. Buildings are planned autonomously, citizens construct them, homes grow the population, and citizens commute between home and work to produce Data.

Read `docs/design.md` before broad gameplay or architectural changes.

`docs/design.md` is the single target-state contract for:

* Gameplay
* Architecture
* Simulation ordering
* Determinism
* Balance defaults
* Rendering boundaries
* Migration scope

There is no separate architecture document.

---

## Target Design and Current Implementation

The repository is being migrated toward the design in `docs/design.md`.

Keep these two kinds of truth separate:

* `docs/design.md` defines the approved target.
* The current branch defines what is presently implemented.

Do not assume that a target mechanic already exists because it appears in the design document.

Do not assume an old mechanic must remain because it exists in the current implementation.

During migration, temporary disagreement between code and design is expected.

For each task:

1. Inspect the current implementation.
2. Identify the assigned migration boundary.
3. Implement only that bounded step.
4. Leave unrelated old systems alone unless their removal is part of the task.
5. Do not opportunistically implement later design stages.
6. Keep the repository runnable after the step.

When old and new APIs must coexist temporarily, keep the compatibility layer narrow and clearly temporary.

---

## Repository Layout

```text
/
├── apps/
│   └── game/
├── packages/
│   ├── shared/
│   ├── simulation/
│   └── renderer/
├── tools/
│   └── balance-runner/
├── tests/
│   └── e2e/
├── docs/
│   └── design.md
├── .github/
│   └── workflows/
├── AGENTS.md
├── README.md
└── package.json
```

Use:

* `docs/design.md` for target gameplay and architecture.
* `README.md` for setup, repository orientation, and migration status.
* `AGENTS.md` for coding-agent behavior.
* Current code and tests for present implementation details.

---

## Agent Orchestration

The primary agent owns:

* Interpreting the request
* Reading the relevant design sections
* Defining the bounded scope
* Resolving architectural questions
* Inspecting the final diff
* Choosing proportionate validation
* Reporting what was and was not verified

Use delegation only when it improves the work.

When named custom agents are available:

* Use `luna_executor` for a bounded implementation assignment.
* Use `luna_reviewer` for cross-package, determinism-sensitive, or otherwise high-risk changes.
* Do not require a separate review agent for trivial documentation, formatting, or narrowly localized changes.
* Do not split a small coherent task across multiple agents merely to create parallel work.

Delegation rules:

1. Give each worker a complete, self-contained assignment.
2. Include relevant paths, fixed contracts, exclusions, and the expected output.
3. At most one workspace-writing agent may edit the worktree at a time.
4. Subagents may not begin later migration steps.
5. Subagents may not spawn additional subagents.
6. The primary agent must inspect the resulting diff.
7. Correct a failed worker with a narrow follow-up rather than restarting all work.
8. Do not use orchestration overhead that costs more than directly completing a small task.

---

## Dependency Direction

The intended package dependency direction is:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

Do not introduce a reverse dependency without an intentional design change.

### `packages/shared`

Contains small engine-independent primitives genuinely shared across packages.

Appropriate examples include:

* Grid coordinates
* Chunk coordinates
* Grid rectangles
* Stable hashing
* Stable comparison helpers
* General fixed-point primitives

Do not turn it into a miscellaneous utility package.

### `packages/simulation`

Owns authoritative state and behavior.

It must:

* Run under Node without a browser
* Import no Babylon.js modules
* Use no DOM or browser APIs
* Use no wall-clock-dependent gameplay decisions
* Avoid `Math.random()`
* Own deterministic randomness
* Own stable entity IDs
* Own command validation
* Define explicit ordering and tie-breaking
* Expose detached serializable snapshots
* Keep snapshot observation mutation-free
* Remain usable by the balance runner

### `packages/renderer`

Projects completed simulation snapshots into Babylon.js state.

It may own:

* Scenes
* Meshes and instances
* Materials
* Camera state
* Interpolation
* Effects
* Visibility decisions
* Renderer-only caches

It must not:

* Decide authoritative behavior
* Generate authoritative IDs
* Mutate simulation state
* Mutate snapshots
* Treat transforms as logical positions
* Observe private partial-tick state
* Make outcomes frame-rate dependent

### `apps/game`

Owns:

* Browser startup
* DOM controls
* Input translation
* Zone placement and removal interactions
* Pause and speed controls
* Simulation-work orchestration
* Command submission
* PWA registration
* Passing completed snapshots to the renderer

Keep substantial simulation rules out of the browser application.

### `tools/balance-runner`

Runs the same authoritative simulation under Node.

It should:

* Import no Babylon.js modules
* Accept explicit seeds and scenarios
* Produce machine-readable output
* Report important invariant failures
* Support deterministic regression and balance checks

Do not expand balance-runner output for every small feature unless the output is directly useful.

---

## Core Gameplay Scope

The target core loop is:

1. Place Living and Working zones.
2. Autonomously plan building sites.
3. Assign citizens to construction.
4. Complete homes and workplaces.
5. Assign citizens to homes and jobs.
6. Commute and produce Data.
7. Grow population from spare home capacity.
8. Add Leisure zones and buildings.
9. Visit Leisure buildings.
10. Double qualifying work-entry Data during leisure cooldown.
11. Use Data to expand.

The target core includes:

* Living, Working, and Leisure zones
* Autonomous building planning
* Incomplete and completed buildings
* Construction labor
* Home and work assignments
* Population growth
* Wandering
* Commuting
* Leisure visits
* Data production
* Fixed-point movement
* Deterministic A*
* Collision resolution
* Tick slicing
* Zone removal
* Snapshot-based rendering

Unless explicitly requested, do not add or preserve as target systems:

* District seeds
* Demand fields
* Space, Access, or Activity indicators
* Services Core
* Research tracks
* Specialization
* Prestige
* Metaprogression
* Learning or Industry systems
* Roads or transit
* Congestion-based routing
* Manual building placement
* Manual citizen assignment
* Individual building demolition
* Redevelopment

Old implementations of these systems may remain temporarily until the assigned migration step removes them.

---

## Authoritative Commands

Player intent enters the simulation through explicit validated commands.

Initial target examples include:

```ts
placeZone(...)
removeZone(...)
```

Command rules:

* Validate entirely in the simulation.
* Return structured accepted or rejected results.
* Centralize costs and geometry.
* Apply at defined tick boundaries.
* Rejected commands must be mutation-free.
* Rejected commands must not consume RNG or entity IDs.
* The UI must not be the final source of validation.
* Identical commands in identical states must replay identically.

Avoid a generic command framework until several commands clearly benefit from one.

---

## Transactional Tick Execution

Simulation and rendering are separate:

```text
Simulation:
    fixed logical ticks
    possibly completed over multiple work calls

Rendering:
    requestAnimationFrame
    interpolation between completed snapshots
```

A logical tick is transactional.

Partial tick state:

* Is private to the simulation
* May contain resumable cursors and temporary buffers
* Must not be rendered
* Must not be exposed as a completed snapshot
* Must not advance differently because of observation

The browser may use elapsed time to decide how often to invoke simulation work, but the simulation receives deterministic work-unit budgets rather than millisecond budgets.

Different work-unit budgets must eventually produce the same completed state for the same initial state and commands.

When modifying tick execution:

* Preserve stage ordering.
* Preserve stable cursors.
* Ensure an entity is not processed twice because work was split.
* Keep movement proposal generation separate from simultaneous commit.
* Keep rendering on completed snapshots.

Do not require a full work-budget equivalence test for every feature. Add or run one when the change directly affects resumable work, stage boundaries, or private partial-tick state.

---

## Determinism

Determinism is a core requirement.

Authoritative behavior must not depend on:

* Wall-clock time
* Render frequency
* CPU speed
* Number of calls used to complete a tick
* Snapshot-read frequency
* Incidental collection iteration
* Renderer ordering

Never use `Math.random()` in `packages/simulation`.

When introducing a decision, define what is needed for that decision:

* Candidate set
* Stable order
* Tie-breaking
* Integer or fixed-point arithmetic where appropriate
* RNG key or RNG consumption order

Prefer keyed deterministic randomness for local decisions such as:

* Wandering targets
* Building-interior destinations
* Sidesteps
* Planning rolls
* Population rolls

Do not add elaborate determinism instrumentation to a small change unless the change actually touches ordering, randomness, serialization, hashing, or resumable execution.

---

## World, Zones, and Buildings

The authoritative world uses signed integer grid coordinates divided into lazily allocated chunks.

Chunks are implementation details and must not affect gameplay at their boundaries.

Zones are axis-aligned rectangles that:

* May cross chunk boundaries
* May contain citizens
* May not overlap other zones
* Permit only compatible building types
* May be removed without a refund

Buildings define:

* A physical footprint
* An exclusion shape
* Assignment capacity
* Construction-worker capacity
* Required labor
* Supported transformations

Placement rules must validate complete shapes, not only anchors.

Required relationships include:

* Physical footprints do not overlap.
* A physical footprint does not overlap another building’s exclusion shape.
* An exclusion shape does not overlap another building’s physical footprint.
* Exclusion shapes may overlap one another.
* The complete exclusion shape remains inside the owning zone.

Incomplete buildings reserve their geometry immediately.

Use stable ordering for:

* Zones
* Archetypes
* Transforms
* Candidate anchors
* Buildings
* Equal planning choices

Do not build a generalized geometry framework beyond what the assigned step requires.

---

## Citizens, Assignments, and Goals

Citizens may have:

* One home assignment
* One work assignment
* One construction assignment
* One temporary leisure reservation
* One active goal

Goal priority is:

1. Construction
2. Leisure
3. Home/work Data production
4. Wandering

Citizens finish their current trip or building activity before selecting a new goal.

New construction opportunities do not interrupt active ordinary trips or activities.

Construction assignments remain until completion or invalidation.

Capacity meanings are distinct:

* Home resident capacity
* Workplace worker capacity
* Leisure visitor capacity
* Construction-worker capacity

Do not conflate these capacities.

Assignment and reassignment must use the rankings in `docs/design.md`.

Avoid storing redundant authoritative state unless consistency is enforced.

---

## Navigation and Movement

Pathfinding operates over orthogonally adjacent logical cells.

It must:

* Use deterministic neighbor ordering
* Use explicit tie-breaking
* Handle no-path results
* Block unrelated building footprints
* Permit the citizen’s route source and destination building as defined by the design
* Avoid treating all citizens as permanent global A* obstacles
* Remain independent of Babylon.js state

Citizen movement uses:

```text
proposal
resolution
simultaneous commit
```

Do not sequentially mutate citizen positions while movement proposals are still being created.

Movement resolution must support the design’s:

* Target conflict priorities
* Dependency chains
* Two-citizen swaps
* Three-or-more occupancy cycles
* Sidesteps
* Bounded replanning
* Emergency recovery
* Global no-progress recovery

Changes to movement conflict resolution are high risk. They should receive at least one focused regression test covering the changed rule.

Do not add continuous crowd physics.

---

## Rendering

Rendering is a downstream projection of completed snapshots.

Use centralized logical-to-world conversion.

Prefer:

* Bounded chunk or multi-chunk ground meshes
* Reusable materials
* Instances or thin instances
* Stable-ID reconciliation
* Bounded dynamic overlays
* Procedural voxel-like geometry

Do not create:

* One permanent mesh per logical cell
* One permanent mesh per completed-building voxel at large scale
* Renderer-owned authoritative positions
* Renderer-generated authoritative IDs

Dynamic layers reconcile by stable ID:

```text
snapshot-only ID -> create
shared ID        -> update
renderer-only ID -> dispose
```

Repeated updates with an unchanged snapshot must not duplicate resources.

---

## UI and Input

The normal interaction model is mouse- and touch-friendly.

Use accessible DOM controls over the Babylon canvas.

Core interaction should not require:

* Keyboard input
* Text entry
* Numeric steppers
* Manual citizen assignment
* Manual building placement

The UI may preview commands, but the simulation performs final validation.

Prefer plain-language rejection messages and large touch targets.

Do not add a large UI framework without clear need.

---

## Testing Philosophy

Testing should provide the smallest useful proof that a change did not break its intended behavior.

Feature implementation should normally be the majority of the work.

Do not spend more time building test infrastructure than implementing a bounded feature unless the feature is especially risky or the user explicitly requests exhaustive verification.

### Default rules

* Do not add a test for every helper, branch, or internal function.
* Do not duplicate the same behavior across unit, integration, renderer, and E2E tests.
* Do not create broad scenario matrices for a localized change.
* Do not add large fixtures when a small direct setup proves the behavior.
* Do not test implementation details that may be refactored safely.
* Do not update many unrelated tests solely to increase coverage.
* Do not run every validation command after every small edit.
* Existing tests may be sufficient; a change does not automatically require a new test.

Add a test when it protects one of these:

* A new player-visible behavior
* A core simulation transition
* A likely regression
* A previous bug
* A determinism-sensitive ordering rule
* A movement or capacity invariant
* A command rejection that could lose state or currency

For most feature steps, one to three focused tests are enough.

### Appropriate validation by change type

#### Documentation-only changes

Usually require no automated tests.

Inspect formatting and links as appropriate.

#### Local TypeScript refactors

Normally run:

```bash
npm run typecheck
```

Run a focused existing test only when the refactor touches behavior.

#### Simulation behavior

Normally:

1. Add or update the smallest focused test that proves the main transition, when existing coverage is insufficient.
2. Run that test file or pattern.
3. Run type checking.

Do not automatically run every simulation scenario.

#### Renderer changes

Normally:

* Run the relevant renderer test when one exists.
* Run the production build.

Add a renderer test only for meaningful resource reconciliation or projection behavior that is otherwise easy to regress.

#### Browser interaction changes

Run a focused E2E test only when:

* The user-facing interaction changed, and
* Lower-level tests or a build cannot adequately verify it.

Do not run the complete E2E suite for every UI change.

#### Cross-package or high-risk changes

Use broader validation when the change affects:

* Public package APIs
* Tick execution
* Serialization or hashes
* Movement resolution
* Zone removal
* Capacity accounting
* Build configuration
* Multiple application layers

Even then, choose the smallest set of commands that exercises the affected paths.

### Full validation

The following are comprehensive tools, not mandatory per-task rituals:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run sim:run -- --seed 1234 --ticks 1000
npm run validate
```

Run the full suite when:

* The user explicitly requests it.
* Preparing a broad integration or release change.
* A cross-cutting migration step affects most packages.
* Focused tests reveal uncertainty about wider breakage.
* CI or repository policy requires it.

Do not run `npm run validate`, all E2E tests, repeated balance scenarios, and repeated deterministic hashes by default for a small change.

### Deterministic replay checks

Repeat identical simulations only when a change directly affects:

* Randomness
* Stable ordering
* Hashing
* Serialization
* Tick slicing
* Movement conflict resolution
* Planning selection
* Population selection

One repeated comparison is normally sufficient unless debugging a failure.

### Reporting

Never claim a command passed unless it ran successfully.

Report:

* Commands actually run
* Exact failures
* Relevant environmental limitations
* Important checks deliberately not run

Do not apologize for skipping irrelevant checks. State that validation was scoped to the change.

---

## Validation Commands on Windows

Under Windows PowerShell, use:

```text
npm.cmd
npx.cmd
```

from the first package-manager command.

Examples:

```powershell
npm.cmd run typecheck
npm.cmd test -- <test-pattern>
npm.cmd run build
npx.cmd playwright test <test-file>
```

Do not change:

* PowerShell execution policy
* Registry
* User profile
* Machine policy

to work around `npm.ps1` or `npx.ps1`.

Platform rule:

* Windows PowerShell: `npm.cmd`, `npx.cmd`
* Other shells: `npm`, `npx`

Report the command actually executed.

---

## Coding Style

Use:

* TypeScript strict mode
* Explicit domain types
* Narrow public APIs
* Small modules with clear ownership
* Pure functions where they make transitions easier to understand
* Descriptive domain names
* Comments for invariants and non-obvious decisions
* Node scripts instead of shell-specific scripts where practical

Avoid:

* Implicit `any`
* Broad singleton state
* Global mutable state
* Dependency-injection frameworks
* ECS architecture unless deliberately adopted
* Speculative generic frameworks
* Premature optimization
* Generic names such as `Manager`, `Helper`, or `Util`
* Generated artifacts committed to the repository

Prefer direct domain code over abstraction added for hypothetical future features.

---

## Performance

Preserve scalable structures, but measure before optimizing.

Prefer:

* Lazy chunk allocation
* Bounded simulation work
* Bounded renderer resource counts
* Instances and thin instances
* Stable spatial indexes
* Reusable allocations in demonstrated hot paths
* Incremental jobs for expensive searches

Do not:

* Compromise determinism for speculative speed
* Introduce worker threads before measurement
* Build a complex performance framework before the core loop works
* Treat one logical cell as one permanent renderer object

---

## Change Workflow

For a normal implementation task:

1. Read the relevant part of `docs/design.md`.
2. Inspect the current code and nearby tests.
3. Define the smallest coherent change.
4. Preserve package ownership and deterministic ordering.
5. Implement the feature.
6. Add or update only the minimal useful test coverage.
7. Run focused validation.
8. Inspect the diff and repository status.
9. Remove accidental or generated files.
10. Report exact results and remaining limitations.

Do not turn a bounded feature into a broad cleanup.

Do not stop at a plan when implementation was requested.

Do not ask for confirmation when the design and current code support a reasonable decision.

---

## Git Practices

* Keep changes scoped.
* Do not rewrite unrelated code.
* Do not modify global Git configuration.
* Do not force-push.
* Do not commit secrets.
* Do not commit generated output.
* Do not silently update dependencies.
* Explain lockfile changes.
* Keep repository status clean except for intentional changes.

For ownership warnings, use a repository-local or one-command safe-directory override instead of global configuration.

---

## Scope Discipline

Unless explicitly requested, defer:

* Multiplayer
* Backend services
* Cloud saves
* Continuous crowd physics
* Roads or transit
* Congestion-based routing
* Detailed business finance
* Advanced voxel meshing
* Large UI frameworks
* External art pipelines
* Audio
* Prestige
* Specialization
* Research systems
* Advanced redevelopment
* Worker threads
* Packaging wrappers

Build the target core loop through small, working migration steps.

---

## Completion Report

Keep completion reports concise and factual.

Report:

* What changed
* Files changed
* Important architectural or ordering decisions
* Tests added or updated, when any
* Commands run and exact results
* Important checks not run
* Remaining limitations
* The next logical migration step, when relevant

Do not provide a long testing inventory when only a focused check was necessary.
