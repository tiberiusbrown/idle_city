# Idle City

Idle City is a browser-first, installable 3D incremental city simulation. This repository contains a deliberately small vertical slice: citizens deterministically commute between voxel homes and workplaces while a Babylon.js client renders interpolated snapshots.

## Architecture

The npm workspace dependency flow is one-way:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

- `packages/shared` contains platform-neutral primitives and stable hashing.
- `packages/simulation` owns authoritative state, pathfinding, schedules, and seeded randomness. It has no Babylon.js, DOM, or browser dependencies.
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
```

The command prints one JSON object containing the seed, executed ticks, citizen count, completed trips, and a stable final-state hash. Repeating identical inputs must produce the same hash.

## Determinism and timing

All random decisions use an explicit `SeededRandom` instance. Never use `Math.random()` in the simulation package. Each call to `simulation.step()` advances exactly one tick and citizens move by no more than one grid cell. The browser runs these steps at 5 Hz while Babylon renders independently. Render positions are interpolated from each citizen's previous and current logical positions; interpolation never feeds back into simulation state.

## Current limitations

The slice uses a fully walkable rectangular grid, two static buildings, a simple alternating home/work schedule, and direct grid paths. There is no economy, saving, district placement, developer AI, traffic, collision avoidance, backend, audio, or wrapper packaging yet.

## Recommended next steps

The next useful feature is a demand model expressed entirely in `packages/simulation`, followed by district seed commands and deterministic autonomous-developer decisions. Add balance-runner scenarios and invariants before exposing those commands in the UI. Later work can add compact save-file versioning, worker-thread simulation, richer voxel batching, and Capacitor packaging without changing the authoritative-state boundary.
