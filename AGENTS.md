# AGENTS.md

## Purpose

This repository contains a browser-first, installable 3D incremental city simulation.

The game uses:

- TypeScript
- Babylon.js
- Vite
- npm workspaces
- Vitest
- Playwright
- `vite-plugin-pwa`

The game presents a voxel-style virtual city whose citizens and developers act autonomously. The player influences the simulation through broad district seeds and simulation upgrades rather than direct building placement or unit micromanagement.

Read `docs/design.md` for gameplay design and `docs/architecture.md` for technical architecture before making broad changes.

---

## Repository Layout

Expected high-level structure:

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

Keep gameplay design documentation in `docs/design.md`.

Keep this file at the repository root. Add narrower `AGENTS.md` files inside subdirectories only when those directories need additional instructions that should override or supplement this file.

---

## Architectural Boundaries

The intended dependency direction is:

```text
shared
  ↑
simulation
  ↑
renderer
  ↑
game
```

The balance runner may import `simulation` and `shared`.

### Simulation package

`packages/simulation` is the authoritative game model.

It must:

- Run directly under Node.
- Use deterministic fixed-step updates.
- Use explicit seeded randomness.
- Avoid Babylon.js imports.
- Avoid DOM and browser-only APIs.
- Avoid UI dependencies.
- Avoid frame-time-dependent logic.
- Avoid `Math.random()`.
- Expose serializable snapshots or equivalent read-only state.
- Keep stable entity IDs.
- Throw clear errors for invalid references and impossible states.

Do not move rendering convenience state into the simulation unless it is part of the authoritative logical model.

### Renderer package

`packages/renderer` translates simulation snapshots into Babylon.js objects.

It may:

- Use Babylon.js.
- Maintain interpolation state.
- Maintain mesh, instance, material, camera, and effect state.
- Use `NullEngine` for tests.

It must not:

- Decide authoritative citizen behavior.
- Modify simulation state through render updates.
- Use render transforms as logical positions.
- Make simulation results depend on frame rate.

### Game application

`apps/game` owns:

- Browser startup
- Main loop wiring
- DOM-based UI
- Input
- PWA registration
- Speed and pause controls
- Connecting the simulation to the renderer

Keep substantial simulation rules out of the application package.

### Shared package

`packages/shared` contains small engine-independent utilities and types that are genuinely shared.

Do not turn it into a miscellaneous dumping ground.

### Balance runner

`tools/balance-runner` must run headlessly and deterministically without Babylon.js, a browser, or a graphical display.

It should produce machine-readable output and deterministic hashes suitable for regression testing.

---

## Simulation Rules

Use a discrete fixed-step simulation.

The render loop and simulation loop are separate:

```text
Simulation:
    fixed logical ticks

Rendering:
    requestAnimationFrame
    interpolation between previous and current logical state
```

A visual entity may store renderer-owned interpolation data such as:

```ts
interface RenderTransform {
  previousPosition: Vec3;
  currentPosition: Vec3;
}
```

Do not expose interpolation progress to simulation code.

When adding simulation behavior:

1. Define the logical state transition.
2. Make it deterministic.
3. Add focused unit tests.
4. Add invariants for invalid state.
5. Expose enough snapshot data for rendering and debugging.
6. Add or update headless metrics when the behavior affects balance.

---

## Gameplay Constraints

The simplified design centers on two player actions:

1. Place a district seed.
2. Buy a simulation upgrade.

Initial district seeds:

- Living
- Working
- Services

Autonomous systems should handle:

- Citizen schedules
- Destination choice
- Path selection
- Building placement
- Construction
- Occupancy
- Path and transit formation
- Redevelopment
- City expansion

Avoid reintroducing unnecessary planning layers such as detailed zoning, individual road placement, per-building approval, or frequent policy micromanagement unless `docs/design.md` is intentionally revised first.

The main city concepts presented to the player are:

- Space
- Access
- Activity

Prefer visible behavioral changes over invisible percentage bonuses.

---

## Voxel Rendering Guidelines

The visual style should clearly resemble a simulated virtual environment.

Prefer:

- Procedural geometry
- Reusable voxel modules
- Thin instances or instances for repeated objects
- Chunk or combined meshes for static completed structures
- Individual voxels during visible construction
- Glowing traces, grid lines, holograms, and wireframes
- Simple materials and lighting
- Clear silhouettes
- Scalable levels of visual detail

Do not create one Babylon.js mesh per permanent voxel in large completed buildings.

A useful strategy is:

```text
Logical building:
    voxel or modular occupancy representation

Under construction:
    visible instanced voxel blocks

Completed:
    combined or chunked mesh

Repeated details:
    thin instances
```

Avoid external art assets unless the task explicitly requires them.

---

## UI and Input Guidelines

The shipped interaction model is mouse- and touch-only.

Use ordinary accessible DOM controls layered over the Babylon.js canvas.

Required characteristics:

- Large touch targets
- Stable accessible names
- No required keyboard input
- No numeric up/down selectors
- No text entry for ordinary gameplay
- Menus and cards usable at mobile viewport sizes
- Pointer and touch input tested through Playwright

Babylon.js should render the city. HTML and CSS should render menus, cards, indicators, and inspection panels.

Keyboard shortcuts may exist for developer-only debugging, but core gameplay must not require them.

---

## Testing Requirements

Every nontrivial change should include the smallest meaningful test at the correct layer.

### Unit tests

Use Vitest for:

- Seeded randomness
- Pathfinding
- Schedule transitions
- Destination scoring
- Developer scoring
- Serialization
- Deterministic snapshots and hashes
- Economy calculations
- Invariants

### Simulation integration tests

Run the pure simulation for many ticks and verify:

- No exceptions
- Stable references
- In-bounds positions
- Valid routes
- Deterministic replay
- No impossible negative counts
- No permanently invalid agent state
- Expected long-run behavior

### Renderer tests

Use Babylon.js `NullEngine` where possible.

Test:

- Scene creation and disposal
- Snapshot-to-render synchronization
- Instance lifecycle
- Interpolation targets
- No mutation of simulation state

### End-to-end tests

Use Playwright for browser-visible behavior:

- App startup
- No unexpected console errors
- Canvas presence
- Pause, normal speed, and fast speed
- Reset
- Seed placement when implemented
- Upgrade purchase when implemented
- Touch-sized viewport behavior
- Save/load when implemented

Capture traces or screenshots on failure.

Do not replace deterministic simulation tests with screenshot tests.

---

## Validation Commands

Before completing a change, run the relevant commands from the repository root.

Expected commands:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run sim:run -- --seed 1234 --ticks 1000
npm run test:e2e
npm run validate
```

For a small localized change, run focused tests first, then the full relevant suite.

When modifying deterministic behavior, run the same headless command at least twice and confirm the determinism hash matches.

Do not claim a command passed unless it was actually run successfully.

If an environment limitation prevents a command from running, report:

- The exact command
- The exact limitation
- What was still validated
- What remains unverified

### Windows PowerShell Command Shims

When commands run under Windows PowerShell, invoke Node.js package-manager commands through their Windows command shims:

```text
npm.cmd
npx.cmd
```

For example:

```powershell
npm.cmd ci
npm.cmd run validate
npm.cmd test
npx.cmd playwright install chromium
```

Do not invoke bare `npm` or `npx` from PowerShell. PowerShell may resolve them to `npm.ps1` or `npx.ps1`, which can be blocked by the machine execution policy.

Do not change the PowerShell execution policy, registry, user profile, or machine configuration to work around this restriction.

Platform rule:

* On Windows PowerShell, use `npm.cmd` and `npx.cmd`.
* On macOS, Linux, or non-PowerShell shells, use `npm` and `npx` normally.
* Once the environment is identified as Windows PowerShell, use the `.cmd` form from the first package-manager command rather than attempting the `.ps1` launcher and retrying after failure.

When reporting commands, record the command that was actually executed, including the `.cmd` suffix.

---

## Coding Style

- Use TypeScript strict mode.
- Avoid implicit `any`.
- Prefer explicit domain types.
- Prefer small modules with clear ownership.
- Avoid broad singleton state.
- Avoid global mutable state.
- Avoid dependency-injection frameworks.
- Avoid an ECS framework unless the existing architecture has deliberately adopted one.
- Avoid premature optimization.
- Avoid speculative abstraction.
- Prefer pure functions for scoring and state transitions.
- Keep public APIs narrow.
- Use comments for invariants and non-obvious reasoning, not to narrate obvious code.
- Preserve cross-platform compatibility.
- Prefer Node scripts over shell-specific scripts.
- Do not commit generated output, build artifacts, browser profiles, or temporary files.

Use descriptive names tied to the game domain rather than generic names such as `Manager`, `Helper`, or `Util`.

---

## Determinism

Determinism is a core requirement, not an optional optimization.

When adding randomness:

- Pass an explicit RNG or seed-derived stream.
- Never use `Math.random()` in simulation code.
- Define iteration order where object or map ordering could matter.
- Avoid wall-clock time in simulation decisions.
- Avoid floating-point comparisons that depend on platform-specific accumulation where practical.
- Keep serialization ordering stable when it contributes to hashes.
- Include relevant state in deterministic hashes.
- Add a regression test.

If changing a determinism hash intentionally, explain why in the change summary.

---

## Performance

Optimize only after measuring, but preserve scalability in design.

Prefer:

- Data-oriented iteration for large homogeneous agent sets where justified
- Spatial indexing for local queries
- Staggered AI updates when behavior permits
- Aggregation for distant or off-screen activity
- Instanced rendering
- Reusable allocations in hot paths
- Headless benchmarks for simulation changes

Do not compromise correctness or determinism for speculative performance.

When optimizing, add or update a benchmark and verify behavior remains identical.

---

## Documentation

Update documentation when behavior, commands, architecture, or project structure changes.

Use:

- `docs/design.md` for player-facing mechanics, progression, balance goals, and game rules.
- `docs/architecture.md` for dependency boundaries, loops, state ownership, rendering synchronization, and technical decisions.
- `README.md` for setup, common commands, project overview, and current capabilities.
- `AGENTS.md` for coding-agent instructions.

Do not duplicate large sections across all documents. Link to the authoritative document.

---

## Change Workflow

For each task:

1. Inspect the relevant files and existing tests.
2. Read the applicable sections of `docs/design.md` and `docs/architecture.md`.
3. Identify the smallest coherent implementation.
4. Preserve package boundaries.
5. Implement the change.
6. Add or update tests.
7. Run focused validation.
8. Run broader validation appropriate to the change.
9. Inspect `git diff`.
10. Remove generated or accidental files.
11. Report what changed and what was verified.

Do not stop after writing a plan when implementation was requested.

Do not ask for confirmation when a reasonable implementation choice can be made from existing design and architecture documents.

---

## Git Practices

- Keep changes scoped to the task.
- Do not rewrite unrelated code.
- Do not modify global Git configuration.
- Do not force-push.
- Do not commit secrets.
- Do not commit generated build directories.
- Do not silently update dependencies unless required by the task.
- Explain intentional lockfile changes.
- Keep `git status` clean except for intentional changes.

When a repository ownership warning prevents Git commands, use a repository-local or one-command safe-directory override rather than changing global Git configuration.

---

## Scope Discipline

Do not implement future systems merely because the architecture anticipates them.

Unless explicitly requested, avoid adding:

- Multiplayer
- Backend services
- Cloud saves
- Detailed traffic physics
- Citizen collision avoidance
- Complex voxel meshing
- Capacitor packaging
- Desktop wrappers
- Large UI frameworks
- External art pipelines
- Audio systems
- Detailed economy simulation
- Prestige before the base loop is proven

Build vertical slices that demonstrate working behavior and remain testable.

---

## Completion Report

At the end of an implementation task, report:

- What changed
- Important architectural decisions
- Tests added or updated
- Commands run
- Validation results
- Remaining limitations
- The next logical task, when useful

Keep the report factual. Do not state that something works unless it was tested or directly inspected.
