# Idle City

Idle City is a browser-first, installable 3D incremental city simulation.

## Implementation status

The repository has been reset to a clean target-core skeleton for rebuilding the game described in [`docs/design.md`](docs/design.md).

The current implementation contains:

- A minimal `createSimulation()` API whose detached snapshot is `{ tick: 0 }`.
- A deterministic simulation hash for headless smoke checks.
- A Babylon.js scene with a neutral background, camera controls, and continuous-looking ground.
- A small browser shell labeled “Idle City / Rebuild skeleton”.
- The existing npm workspaces, PWA setup, and validation infrastructure.

Gameplay systems are intentionally not implemented yet.

## Repository architecture

The npm workspace dependency direction is:

```text
shared <- simulation <- renderer <- game
             ^
             +-- balance-runner
```

- `packages/shared` contains small platform-neutral utilities.
- `packages/simulation` owns authoritative state and deterministic behavior.
- `packages/renderer` projects completed snapshots into Babylon.js state.
- `apps/game` owns browser startup and the PWA shell.
- `tools/balance-runner` runs the simulation headlessly under Node.
- `tests/e2e` is reserved for future browser-level Playwright checks.

## Setup

Use Node.js 22 or newer and npm 10 or newer.

```bash
npm install
npm run dev
```

Vite prints the local development URL. A production build is available through:

```bash
npm run build
```

## Common commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run sim:run -- --seed 1234 --ticks 0
```

The balance runner prints one machine-readable JSON object containing the current tick and stable hash.

Playwright remains configured through `playwright.config.ts`; browser tests will be added when a user-facing interaction exists.

See [`AGENTS.md`](AGENTS.md) for repository workflow and focused validation guidance.
