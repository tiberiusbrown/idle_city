# AGENTS.md

## Multi-agent orchestration

When the primary thread uses GPT-5.6 Sol, Sol is the orchestrator.

Sol owns:

- interpreting the user request,
- reading the implementation playbook,
- decomposing work,
- selecting bounded assignments,
- resolving architectural questions,
- reviewing worker results,
- running or requesting final integration validation,
- deciding whether the task gate is satisfied,
- reporting final status to the user.

Implementation must normally be delegated to the `luna_executor` custom agent.

Review must normally be delegated to the `luna_reviewer` custom agent after implementation.

Delegation rules:

1. Spawn only named custom agents.
2. Do not use an unnamed or built-in worker when `luna_executor` is available.
3. Give each worker a complete, self-contained assignment.
4. Include relevant paths, fixed contracts, exclusions, required tests, and expected report format.
5. Wait for the executor before starting review.
6. At most one workspace-write subagent may edit the current worktree at a time.
7. Read-only exploration and review may run in parallel when their responsibilities do not overlap.
8. Sol must inspect the resulting diff rather than accepting a worker's summary as proof.
9. Sol owns final validation and scope auditing.
10. Subagents may not begin later playbook steps.
11. Subagents may not spawn further subagents.
12. A failed or incomplete worker must receive a narrowly targeted correction task; do not restart the entire implementation without evidence that it is necessary.

---

## Purpose

This repository contains **Idle City**, a browser-first, installable 3D incremental city simulation.

The game uses:

- TypeScript
- Babylon.js
- Vite
- npm workspaces
- Vitest
- Playwright
- `vite-plugin-pwa`

The player places broad district seeds and purchases simulation upgrades. Citizens, developers, construction, travel, and growth are autonomous.

Read `docs/design.md` and `docs/architecture.md` before broad changes.

---

## Repository Truth

Inspect the current checkout and tests before acting.

Do not infer that a planned feature exists because it appears in:

- `docs/design.md`
- a roadmap
- a prompt
- an issue
- an earlier conversation
- an uncommitted agent run

The current branch is the source of truth for implementation state.

At the time this file was updated, the committed baseline includes deterministic spatial demand. District seed work may exist on a later branch, but agents must inspect rather than assume.

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
│   ├── design.md
│   └── architecture.md
├── .github/
│   └── workflows/
├── AGENTS.md
└── package.json
```

Use:

- `docs/design.md` for player-facing mechanics and balance goals.
- `docs/architecture.md` for state ownership, loops, data flow, and technical decisions.
- `README.md` for setup, commands, and current capabilities.
- `AGENTS.md` for coding-agent constraints.

---

## Dependency Direction

The intended dependency direction is:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

No package may introduce a reverse dependency without an intentional architecture change.

### `packages/simulation`

The authoritative model.

It must:

- Run under Node without a browser.
- Advance only through explicit fixed logical steps.
- Own seeded randomness.
- Avoid Babylon.js.
- Avoid DOM and browser APIs.
- Avoid wall-clock-dependent decisions.
- Avoid `Math.random()`.
- Expose detached serializable snapshots.
- Keep stable entity IDs.
- Validate references and impossible states.
- Define explicit ordering and tie-breaking.
- Remain usable by the headless balance runner.

### `packages/renderer`

A downstream projection of snapshots.

It may own:

- Babylon scenes
- meshes and instances
- materials
- camera state
- effects
- interpolation
- renderer-only caches

It must not:

- decide authoritative behavior,
- generate authoritative IDs,
- mutate simulation state,
- mutate snapshots,
- use transforms as logical positions,
- make simulation results frame-rate dependent.

### `apps/game`

Owns:

- browser startup
- fixed-step loop wiring
- DOM controls
- input translation
- PWA registration
- speed controls
- command submission
- connecting simulation snapshots to renderer

Keep substantial simulation rules out of the game application.

### `packages/shared`

Contains only small engine-independent primitives that are genuinely shared.

Do not use it as a miscellaneous utility package.

### `tools/balance-runner`

Must:

- run headlessly,
- import no Babylon.js,
- produce machine-readable stable output,
- run deterministic scenarios,
- report invariant failures,
- support regression and balance analysis.

---

## Fixed-Step Simulation

Simulation and rendering are separate:

```text
Simulation:
    fixed logical ticks

Rendering:
    requestAnimationFrame
    interpolation between snapshots
```

Each citizen moves at most one logical navigation cell per tick unless the design is deliberately revised.

Interpolation progress belongs only to the renderer.

When adding simulation behavior:

1. Define the authoritative transition.
2. Define ordering and tie-breaking.
3. Make it deterministic.
4. Add focused tests.
5. Add invalid-state invariants.
6. Expose only necessary snapshot state.
7. Update headless metrics and scenarios.
8. Verify repeated-run equality.

---

## Player Actions and Scope

The main recurring player actions are:

1. Place a district seed.
2. Buy a simulation upgrade.

Starting seed kinds:

- Living
- Working
- Services

Autonomous systems own:

- citizen schedules
- destination choice
- path selection
- building placement
- construction
- occupancy
- traffic formation
- redevelopment
- city expansion

Do not reintroduce detailed zoning, individual road placement, building-by-building approval, or unit micromanagement without intentionally revising the design.

The primary city concepts are:

- Space
- Access
- Activity

Prefer visible behavioral changes over hidden percentage bonuses.

---

## Authoritative Commands

Player intent enters the simulation through explicit validated commands.

Examples:

- `placeDistrictSeed(...)`
- future upgrade-purchase commands

Command rules:

- Validate entirely in simulation.
- Return structured accepted/rejected results.
- Centralize costs and unlock rules.
- Rejected commands must be mutation-free.
- Rejected commands must not consume RNG or IDs.
- The UI must not duplicate authoritative validation.
- Identical commands at identical ticks must replay identically.

Avoid a generic command framework until multiple commands clearly require one.

---

## Fine-Grained Logical Grid

The logical navigation grid is intentionally finer than the visible building scale.

A typical small building should occupy approximately `5 × 5` logical cells. Larger buildings may occupy larger rectangles. Citizens occupy and move over individual logical cells.

Keep three coordinate concepts separate:

1. **Logical grid coordinates**
   - authoritative simulation positions
   - used for movement, occupancy, entrances, demand, and placement

2. **Building/project footprints**
   - authoritative rectangles or explicit logical-cell regions
   - cover multiple navigation cells

3. **Babylon world coordinates**
   - renderer-owned projections
   - derived through centralized conversion functions

Do not assume one logical cell equals one Babylon world unit.

A reasonable initial scale is approximately:

- logical map: `60 × 50`
- logical cell: `0.25` world units
- home: `5 × 5` cells
- workplace: `7 × 7` cells

These are starting points, not scattered literals. Keep chosen values centralized and documented.

---

## Building and Project Footprints

Use one authoritative footprint representation.

Prefer a rectangle such as:

```ts
interface GridRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
```

Derive occupied cells in stable row-major order.

Do not store several redundant authoritative forms—such as anchor, center, dimensions, and occupied cells—unless consistency is enforced.

Every building type must define or derive:

- footprint dimensions
- occupied cells
- one or more entrance candidates
- selected entrance
- capacity
- orientation if orientation is implemented

All building footprint cells are non-walkable.

Active construction projects reserve their entire footprint. Document the construction phase at which reserved cells become non-walkable.

Placement validation must check the complete footprint, not only an anchor cell.

Reject placement when:

- any cell is out of bounds,
- any cell overlaps a building,
- any cell overlaps a reserved project,
- any cell overlaps another reserved object,
- the entrance is invalid,
- the entrance is unreachable,
- another documented buildability rule fails.

Use stable ordering for:

- footprint cells
- candidate anchors
- building types
- orientations
- entrance candidates
- equally scored placements

---

## Entrances

Citizens route to building entrances, not building centers or blocked interiors.

An entrance should normally be:

- outside the blocked footprint,
- orthogonally adjacent to the perimeter,
- in bounds,
- walkable,
- reachable from surrounding walkable space.

Citizens must never occupy blocked building-interior cells.

It is acceptable before local collision avoidance is implemented for multiple inactive citizens to share an entrance cell. Once reservations are introduced, entrance throughput and queue semantics must be explicit.

Access and planned trip distance should use entrance-to-entrance travel, not arbitrary building-center distance.

Demand proximity should use a documented spatial reference such as:

- nearest entrance,
- distance to footprint,
- or another intentionally chosen measure.

---

## Pathfinding

Pathfinding operates over individual logical cells.

It must:

- accept or derive static walkability,
- block complete building footprints,
- block relevant project footprints,
- leave valid entrances walkable,
- use explicit deterministic neighbor ordering,
- return adjacent moves,
- remain in bounds,
- handle no-path cases explicitly,
- avoid Babylon.js and render transforms.

The current pathfinder's walkability callback is an appropriate seam. Do not replace it with a broad navigation framework without need.

Do not initially treat every citizen's current cell as a permanent global pathfinding obstacle. Doing so causes excessive replanning, oscillation, and deadlock.

---

## Traffic Development Stages

Implement citizen traffic in stages.

### Stage 1: Route usage

Record deterministic logical edge or cell traversal usage.

Prefer edge usage when direction and corridors matter.

Requirements:

- canonical stable keys,
- bounded history,
- logical-tick timing,
- stable snapshot ordering,
- no wall-clock decay.

### Stage 2: Congestion-aware long-range routing

Use historical traffic as a bounded path cost.

Prefer integer costs to reduce floating-point ambiguity.

Requirements:

- base positive movement cost,
- bounded congestion penalty,
- explicit tie-breaking,
- route calculation normally at trip start,
- no per-tick global replanning,
- current citizen positions are still not static obstacles.

### Stage 3: Local movement reservations

When immediate collision avoidance is implemented, use:

1. proposal,
2. resolution,
3. simultaneous commit.

Do not mutate citizens sequentially in a way that makes results depend on array order.

Suggested conflict priority:

1. greater wait age,
2. fewer remaining route cells,
3. earlier trip start,
4. stable citizen ID.

Define:

- target-cell conflict policy,
- opposite-direction edge-swap policy,
- queue behavior,
- anti-starvation behavior,
- bounded deadlock recovery,
- replan threshold.

Do not add continuous crowd physics unless the design is intentionally changed.

---

## Demand, Indicators, and Data

The simulation currently exposes:

- Space
- Access
- Activity
- Data
- spatial Living, Working, and Services demand

Demand cells must:

- cover the logical grid,
- use stable row-major order,
- contain finite bounded values,
- expose stable totals,
- remain detached in snapshots.

District seed influence should enter through authoritative simulation state and pure demand calculations.

Data:

- is authoritative,
- changes only in logical simulation transitions,
- uses centralized activity values and costs,
- uses deterministic rounding,
- must never depend on rendering or wall-clock timing.

---

## Autonomous Developers and Construction

Developer evaluation must:

- run on a fixed cadence,
- enumerate candidates in stable order,
- validate complete footprints,
- validate entrances,
- use pure scoring where practical,
- define exact tie-breaking,
- avoid consuming RNG for rejected candidates,
- save a player-readable reason.

Construction projects must:

- own stable IDs,
- reserve complete footprints,
- advance through tick-based phases,
- eventually complete or fail explicitly,
- create buildings with matching footprints and entrances,
- expose enough state for rendering and explanation.

Do not add demolition, conversion, redevelopment, or transit until the base build loop works.

---

## Population and Occupancy

Population growth must require compatible available capacity.

Rules:

- home and workplace references must exist,
- references must match building types,
- occupancy must not exceed capacity,
- assignments use documented spatial cost,
- equal assignments use stable tie-breaking,
- population respects a configured cap,
- citizen IDs are stable,
- existing citizens are not silently reassigned unless relocation is the task.

Footprint area does not automatically equal capacity.

---

## Rendering Guidelines

The visual style should use procedural voxel-like geometry, reusable modules, instances, grid lines, holograms, and clear silhouettes.

Prefer:

- one ground mesh or chunked ground,
- grid materials or shaders,
- combined completed-building meshes,
- thin instances for repeated details,
- individual instanced voxels during construction,
- dynamic overlays only for relevant cells/edges.

Do not create one permanent Babylon mesh per logical navigation cell on a large map.

Do not create one permanent mesh per voxel in completed large buildings.

Centralize logical-to-world coordinate conversion.

Dynamic renderer layers should reconcile by stable ID:

```text
renderer-only IDs -> dispose
snapshot-only IDs -> create
shared IDs        -> update
```

Repeated updates with an unchanged snapshot must not duplicate resources.

Use `NullEngine` for renderer tests where possible.

---

## UI and Input

The shipped interaction model is mouse- and touch-only.

Use accessible DOM controls over the Babylon canvas.

Requirements:

- large touch targets,
- stable accessible names,
- no required keyboard input,
- no text entry for ordinary play,
- no numeric steppers,
- mobile viewport support,
- pointer and touch Playwright coverage,
- plain-language command rejection,
- `aria-live` for important status.

Babylon renders the city. HTML/CSS renders menus, cards, indicators, and inspection panels.

Pointer-to-logical-grid conversion must use centralized coordinate rules and must not make meshes authoritative.

---

## Testing

Every nontrivial change needs the smallest meaningful test at the correct layer.

### Unit tests

Use Vitest for:

- seeded randomness
- pathfinding
- footprints
- entrances
- placement validation
- demand
- command rejection
- destination scoring
- developer scoring
- construction phases
- occupancy
- traffic costs
- movement conflict resolution
- serialization
- stable hashes
- economy calculations
- invariants

### Simulation integration tests

Verify:

- no exceptions
- unique stable IDs
- valid references
- in-bounds positions
- no building-interior citizen positions
- valid adjacent routes
- valid entrances
- no overlap
- capacity respected
- deterministic replay
- no negative counts
- no permanently invalid agent state
- long-run progress

### Renderer tests

Use `NullEngine` where possible.

Test:

- scene creation/disposal
- snapshot reconciliation
- entity creation/removal
- interpolation
- footprint dimensions
- project phases
- no duplicate resources
- no snapshot mutation
- bounded ground mesh count

### E2E tests

Use Playwright for:

- startup
- no console errors
- canvas
- speed controls
- reset
- seed placement
- touch-sized viewport
- construction visibility
- dynamic population
- traffic overlay when implemented
- upgrades and saves only when implemented

Do not replace deterministic simulation tests with screenshot tests.

---

## Validation Commands

Run focused tests first, then the full relevant suite.

Expected root commands:

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

When deterministic behavior changes:

- run the same headless command at least twice,
- compare the complete JSON,
- confirm the hash matches,
- repeat important named scenarios.

Do not claim a command passed unless it actually ran successfully.

Report exact environmental limitations and unverified items.

### Windows PowerShell command shims

Under Windows PowerShell, use:

```text
npm.cmd
npx.cmd
```

from the first package-manager command.

Examples:

```powershell
npm.cmd ci
npm.cmd run validate
npm.cmd test
npx.cmd playwright install chromium
```

Do not first attempt bare `npm` or `npx`.

Do not change:

- PowerShell execution policy,
- registry,
- user profile,
- machine policy

to work around `npm.ps1` or `npx.ps1`.

Platform rule:

- Windows PowerShell: `npm.cmd`, `npx.cmd`
- Other shells: `npm`, `npx`

Report the command actually executed, including `.cmd`.

---

## Determinism

Determinism is a core requirement.

When adding decisions:

- define input state,
- define candidate order,
- define tie-breaking,
- define rounding,
- define RNG consumption order if RNG is necessary.

Never:

- use `Math.random()` in simulation,
- use wall-clock time,
- depend on render frequency,
- depend on incidental object iteration,
- depend on renderer object order,
- consume RNG for rejected/no-op operations without documenting it.

Prefer:

- sorted arrays,
- stable entity IDs,
- integer costs,
- fixed logical windows,
- explicit comparators,
- deterministic serialization.

If a hash changes intentionally, explain which authoritative state or transition changed.

---

## Coding Style

- TypeScript strict mode
- no implicit `any`
- explicit domain types
- small modules with clear ownership
- narrow public APIs
- pure functions for scoring and transitions where practical
- no broad singleton state
- no global mutable state
- no dependency-injection framework
- no ECS unless deliberately adopted
- no speculative generic framework
- no premature optimization
- comments for invariants and non-obvious reasoning
- descriptive domain names
- Node scripts over shell-specific scripts
- no generated artifacts committed

Avoid generic names such as `Manager`, `Helper`, or `Util`.

---

## Performance

Measure before optimizing, but preserve scalable structures.

Prefer:

- bounded renderer mesh counts,
- instances/thin instances,
- stable spatial occupancy views,
- data-oriented loops where justified,
- reusable allocations in hot paths,
- staggered AI updates,
- headless scenarios and benchmarks.

Do not compromise correctness or determinism for speculative performance.

A finer logical grid must not imply one render object per cell.

---

## Change Workflow

For each task:

1. Inspect current files, branch, and tests.
2. Read relevant design and architecture sections.
3. Identify the smallest coherent implementation.
4. State authoritative data and ordering.
5. Preserve package boundaries.
6. Implement.
7. Add focused tests.
8. Add/update invariants and balance scenarios.
9. Run focused validation.
10. Run the full relevant suite.
11. Repeat deterministic scenarios.
12. Inspect `git diff` and `git status`.
13. Remove generated/accidental files.
14. Report exact results.

Do not stop at a plan when implementation was requested.

Do not ask for confirmation when a reasonable decision can be made from current code and docs.

---

## Git Practices

- Keep changes scoped.
- Do not rewrite unrelated code.
- Do not modify global Git configuration.
- Do not force-push.
- Do not commit secrets.
- Do not commit generated output.
- Do not silently update dependencies.
- Explain lockfile changes.
- Keep status clean except intentional changes.

For repository ownership warnings, use a repository-local or one-command safe-directory override rather than global configuration.

---

## Scope Discipline

Unless explicitly requested, defer:

- multiplayer
- backend services
- cloud saves
- continuous crowd physics
- transit before walking traffic works
- detailed business finance
- complex voxel meshing
- Capacitor/desktop wrappers
- large UI frameworks
- external art pipelines
- audio
- prestige before the base loop
- advanced redevelopment
- worker threads before measurement

Build tested vertical slices.

---

## Completion Report

Report:

- what changed,
- architectural decisions,
- ordering/tie-breaking,
- files changed,
- tests added,
- scenarios added,
- commands run,
- exact results,
- repeated-run comparison,
- intentional hash changes,
- remaining limitations,
- one next logical task.

Keep the report factual.
