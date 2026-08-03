# Idle City

Idle City is a browser-first, installable 3D incremental city simulation.

The player places broad Living, Working, and Leisure zones. Buildings are planned autonomously, citizens construct them, homes grow the population, and citizens commute between home and work to produce Data.

The repository is being migrated toward a simpler core gameplay loop focused on:

* Zone placement
* Autonomous building planning
* Citizen construction
* Home and work assignments
* Population growth
* Commuting
* Leisure visits
* Data production
* Deterministic, scalable simulation

Research, specialization, prestige, spatial demand, district seeds, and other progression systems are outside the current target.

## Design

[`docs/design.md`](docs/design.md) is the single target-state contract for both gameplay and architecture.

It defines:

* The core gameplay loop
* Authoritative simulation rules
* Tick slicing
* Determinism
* World and chunk representation
* Zones and buildings
* Citizen movement and assignments
* Rendering boundaries
* Balance defaults
* Migration rules

The current codebase is being migrated incrementally and may temporarily contain older systems that are not part of the target design.

The current branch is the source of truth for what is implemented today. The design document is the source of truth for the intended destination.

## Repository Architecture

The npm workspace dependency direction is:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

* `packages/shared` contains small platform-neutral primitives.
* `packages/simulation` owns authoritative state, deterministic behavior, pathfinding, world storage, and serializable snapshots.
* `packages/renderer` translates completed snapshots into Babylon.js scene state.
* `apps/game` owns browser startup, controls, input, timing orchestration, and the PWA shell.
* `tools/balance-runner` runs the same simulation headlessly under Node.
* `tests/e2e` contains browser-level Playwright checks.

Simulation code has no Babylon.js, DOM, or browser dependency.

Rendering never determines authoritative outcomes.

## Setup

Use Node.js 22 or newer and npm 10 or newer.

```bash
npm install
npm run dev
```

Vite prints the local development URL.

The browser experience supports mouse and touch controls. A production build is available through:

```bash
npm run build
```

## Common Commands

### Development

```bash
npm run dev
```

### Type checking

```bash
npm run typecheck
```

### Focused tests

```bash
npm test -- <test-file-or-pattern>
```

### All Vitest tests

```bash
npm test
```

### Production build

```bash
npm run build
```

### Browser E2E tests

```bash
npm run test:e2e
```

### Comprehensive validation

```bash
npm run validate
```

`validate` is intended for broad integration checks. It is not necessary after every small change.

Development should normally use the smallest relevant validation:

* Type checking for local TypeScript changes
* One focused test for a simulation behavior
* A build for renderer or browser integration
* Focused E2E only for an interaction that cannot be verified at a lower layer

See [`AGENTS.md`](AGENTS.md) for the repository’s focused testing policy.

## Headless Balance Runner

Run the simulation without a browser or graphics stack:

```bash
npm run sim:run -- --seed 1234 --ticks 1000
```

Named scenarios may also be available:

```bash
npm run sim:run -- --scenario <scenario-name> --seed 1234 --ticks 1000
```

The balance runner is used for:

* Deterministic smoke checks
* Economy experiments
* Long-running simulation scenarios
* Movement and gridlock scenarios
* Stable state hashes
* Machine-readable metrics

Scenario names and output fields may change during the migration to the new design.

## Determinism and Timing

The authoritative simulation uses fixed logical ticks.

The target normal speed is five ticks per second, while Babylon.js renders independently.

A logical tick may be completed across multiple bounded work calls. Partial tick state remains private to the simulation, and the renderer interpolates only between completed snapshots.

Authoritative behavior must not depend on:

* Render frame rate
* CPU speed
* Wall-clock timing
* Snapshot-read frequency
* Number of work calls used to complete a tick

Simulation randomness is explicit and deterministic. `Math.random()` must not be used in the simulation package.

## Target Opening

The target default opening contains:

* Four wandering citizens near `(0, 0)`
* 10 Data
* No zones
* No buildings
* No home assignments
* No work assignments

The first Living zone costs 4 Data, and the first Working zone costs 6 Data.

This allows the player to establish the initial Living and Working zones immediately and begin the autonomous construction loop.

## Migration Status

The project is transitioning from its earlier district-seed, demand, research, and service-oriented vertical slice.

Migration work should proceed through small, working steps:

1. Establish the new authoritative types and boundaries.
2. Introduce resumable transactional tick execution.
3. Add zones and autonomous building planning.
4. Migrate citizen movement and building interiors.
5. Add the new construction rules.
6. Add assignments, commuting, and Data production.
7. Add population growth.
8. Add Leisure behavior.
9. Replace old UI and renderer concepts.
10. Remove remaining obsolete systems.

Each step should keep the repository runnable. Temporary compatibility code is acceptable when narrowly scoped.

## Contribution Guidance

Read these files before broad changes:

* [`docs/design.md`](docs/design.md)
* [`AGENTS.md`](AGENTS.md)

Key principles:

* Keep simulation behavior authoritative and deterministic.
* Preserve the package dependency direction.
* Keep rendering downstream of completed snapshots.
* Implement only the assigned migration step.
* Prefer direct domain code over speculative frameworks.
* Use the smallest meaningful tests and validation for the change.
* Do not preserve retired systems as future design requirements.
