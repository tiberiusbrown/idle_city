# Idle City

Idle City is a browser-first, installable 3D incremental city simulation. This repository contains a deliberately small vertical slice: citizens deterministically commute between multi-cell voxel homes and workplaces, travel to active construction sites, and provide authoritative labor while deterministic developers score district demand and stage footprint-aware construction in a lazy, signed-world chunk model.

## Architecture

The npm workspace dependency flow is one-way:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

- `packages/shared` contains platform-neutral primitives and stable hashing.
- `packages/simulation` owns authoritative state, lazy chunk/ROW storage, footprints, circulation envelopes, entrances, chunk-aware A*, incremental developer jobs, schedules, and seeded randomness. It has no Babylon.js, DOM, or browser dependencies.
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

Step 10.5 adds deterministic four-profile equal-cost route ties, baseline
stuck recovery at waits 4, 8, 12, and so on, and per-project critical-builder
state after 12 zero-labor ticks. Recovery uses only current start-of-tick
occupancy and wait state; historical traffic is deliberately excluded until
the future ACCESS-2 congestion-routing upgrade. District influence is an
axis-aligned square with Chebyshev distance: Living/Working/Services use
radius and side lengths 10/21, 12/25, and 8/17. The Build flow reads these
authoritative values and uses a responsive selector, scrollable details, and
persistent confirmation dock.

The command prints one JSON object containing the scenario, seed, executed ticks, citizen count and population cap, completed trips and work/service activities, service trips/uses/waits, Data by work/service source, Services Core state and purchase results, demand totals, the three normalized city indicators, active/allocated chunk and ROW counters, demand dirty/evaluation counts, incremental developer job progress and budget peaks, construction labor counters, path instrumentation, scheduled command previews/results, invariant failures, and a stable final-state hash. Named scenarios also cover `sparse-expansion`, `extent`, `localized-demand`, `long-route`, `living-led`, `working-led`, `equal-score`, `obstacle-constrained`, `no-valid-footprint`, `long-run-construction`, `housing-surplus`, `workplace-surplus`, `balanced-expansion`, `tie`, `capped-growth`, `long-run-city`, `seed-boundary`, `multiple-same-type-seeds`, `sparse-development`, `two-connected-row-buildings`, `narrow-connector`, `dense-circulation`, `development-supersession`, `long-incremental-development`, `step9-dense-movement`, `one-worker-slow-build`, `full-staff-build`, `workers-competing-one-corridor`, `staging-cell-queue`, `worker-blocked-replans`, `no-eligible-workers`, `phase-cap-decrease`, `construction-dense-commute`, `off-screen-construction`, `repeated-deterministic-construction`, `services-core-progression`, `no-service-shortage`, `one-service-near-homes`, `one-service-near-workplaces`, `competing-services`, `service-capacity-bottleneck`, `services-seed-development`, and `dense-service-commute`. Omitting `--scenario` preserves the baseline command. Repeating identical inputs must produce byte-identical JSON and the same hash.

## Determinism and timing

All random decisions use an explicit `SeededRandom` instance. Never use `Math.random()` in the simulation package. Each call to `simulation.step()` advances exactly one tick and citizens move by no more than one logical cell. The world is a signed coordinate space with only explicitly active chunks allocated; negative coordinates use floor-based chunk conversion. Demand refresh occurs during deterministic simulation transitions, and snapshots/queries are observation-pure. The browser runs steps at 5 Hz while Babylon renders independently. Render positions are interpolated from each citizen's previous and current logical positions; interpolation never feeds back into simulation state.

## Current limitations

The slice uses a finite active-chunk set, fixed-radius Living/Working/Services district seeds with exact preview and confirmation, Services Core with tier-1 focus selection, compact public ROW, one-cell circulation envelopes, deterministic two-cell connectors, multi-cell buildings and construction projects, three-cell worker staging, exterior entrances, deterministic population growth over compatible home/work capacity, entrance-distance assignment, a simple home/work/service schedule, construction commute and labor states, deterministic A* routes, bounded internal traffic telemetry, chunked demand influence, incremental deterministic developer scoring, labor-driven survey/blueprint/foundation/frame/completion phases, deterministic Data plus Space/Access/Activity indicators with work/service source accounting, and dynamic stable-ID renderer reconciliation for buildings, citizens, projects, and seeds. Automatic expansion policy, congestion response, player-facing Traffic Analysis, paved roads or transit, demolition or ROW removal, backend, audio, and wrapper packaging are not implemented.

## Recommended next steps

The current slice includes Services Core, tier-1 focus selection, Services seed placement, service-building construction, citizen service need/use, Services demand, and headless service scenarios. Rank-1 research effects remain deferred; the next focused slice is limited to tier-1 research.
