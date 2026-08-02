# Idle City

Idle City is a browser-first, installable 3D incremental city simulation. This repository contains a deliberately small vertical slice: citizens deterministically commute between multi-cell voxel homes and workplaces while deterministic developers score district demand and stage footprint-aware construction in a lazy, signed-world chunk model.

## Architecture

The npm workspace dependency flow is one-way:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

- `packages/shared` contains platform-neutral primitives and stable hashing.
- `packages/simulation` owns authoritative state, lazy chunk storage, footprints, entrances, chunk-aware A*, schedules, and seeded randomness. It has no Babylon.js, DOM, or browser dependencies.
- `packages/renderer` translates immutable simulation snapshots into Babylon.js scene state.
- `apps/game` owns the fixed-step browser loop, controls, PWA shell, and DOM overlay.
- `tools/balance-runner` steps the same simulation directly under Node and emits JSON.
- `tests/e2e` verifies the assembled browser experience.

See [docs/architecture.md](docs/architecture.md) for design details.

## Setup and development

Use Node.js 22 or newer and npm 10 or newer.

```bash
npm install
npm run dev
```

Vite prints the local URL. The game supports mouse drag, mouse-wheel zoom, touch rotation, and pinch zoom. A production PWA build is available through `npm run build`.

## Validation

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run validate
```

`validate` runs formatting, lint, strict TypeScript checking, unit/integration tests, the deterministic simulation smoke test, and the production PWA build. Browser E2E remains a separate command because it requires an installed Playwright Chromium binary.

## Headless balance runner

Run thousands of logical ticks without a browser or graphics stack:

```bash
npm run sim:run -- --seed 1234 --ticks 1000
npm run sim:run -- --scenario long-commute --seed 1234 --ticks 1000
```

The command prints one JSON object containing the scenario, seed, executed ticks, citizen count and population cap, completed trips and work activities, Data, demand totals, the three normalized city indicators, active/allocated chunk counters, demand dirty/evaluation counts, construction counts, path instrumentation, scheduled command results, invariant failures, and a stable final-state hash. Named scenarios also cover `sparse-expansion`, `extent`, `localized-demand`, `long-route`, `living-led`, `working-led`, `equal-score`, `obstacle-constrained`, `no-valid-footprint`, `long-run-construction`, `housing-surplus`, `workplace-surplus`, `balanced-expansion`, `tie`, `capped-growth`, and `long-run-city`. Omitting `--scenario` preserves the baseline command. Repeating identical inputs must produce byte-identical JSON and the same hash.

## Determinism and timing

All random decisions use an explicit `SeededRandom` instance. Never use `Math.random()` in the simulation package. Each call to `simulation.step()` advances exactly one tick and citizens move by no more than one logical cell. The world is a signed coordinate space with only explicitly active chunks allocated; negative coordinates use floor-based chunk conversion. The browser runs steps at 5 Hz while Babylon renders independently. Render positions are interpolated from each citizen's previous and current logical positions; interpolation never feeds back into simulation state.

## Current limitations

The slice uses a finite active-chunk set, multi-cell buildings and construction projects, exterior entrances, deterministic population growth over compatible home/work capacity, entrance-distance assignment, a simple alternating home/work schedule, deterministic A* routes, deterministic district seed commands and chunked demand influence, deterministic developer scoring, staged survey/blueprint/foundation/frame/completion phases, and deterministic Data plus Space/Access/Activity indicators. There are no browser seed controls, automatic expansion policy, services, traffic, collision avoidance, backend, audio, or wrapper packaging yet. Dynamic renderer reconciliation for newly constructed buildings and citizens remains the next renderer task.

## Recommended next steps

The next useful feature is dynamic renderer reconciliation by stable entity ID for newly constructed buildings and citizens. Later work can add compact save-file versioning, worker-thread simulation, richer voxel batching, and Capacitor packaging without changing the authoritative-state boundary.
