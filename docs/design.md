# Virtual Crowd-Built City

## 0. Document Authority

This document is the authoritative gameplay-design contract for Idle City.

It serves two audiences:

- People designing, implementing, testing, and balancing the game.
- AI coding agents that need exact boundaries and must not invent mechanics outside the approved plan.

Every substantial mechanic has one of three statuses:

- **Implemented** — exists in the repository and must remain consistent with code and tests.
- **Contracted** — approved future behavior. It may be implemented only when a task explicitly includes it.
- **Deferred** — intentionally undefined or postponed. Agents must not invent an implementation.

Rules for interpretation:

1. Implemented and Contracted sections are normative.
2. Examples, visual descriptions, and design rationale do not override a stated contract.
3. A future mechanic mentioned outside a Contracted section is not permission to implement it.
4. If code and an Implemented contract disagree, the discrepancy must be reported and reconciled. Do not silently choose one.
5. Balance constants in this document are authoritative defaults until deliberately revised.
6. All progression requirements are based on state, completed actions, or numeric thresholds. Elapsed real time and fixed tick-wait gates are prohibited.
7. Determinism, stable ordering, and mutation-free rejection are gameplay requirements as well as engineering requirements.
8. New systems should be introduced through the progression structure in this document rather than exposed immediately.

---

## 1. Concept

Idle City is a touch-friendly incremental game about operating a visibly artificial, voxel-based city simulation.

The player does not place individual buildings, roads, or citizens. The player uses two recurring actions:

1. Place broad **district seeds** that influence where activity develops.
2. Purchase **simulation research** that changes autonomous behavior.

Citizens follow schedules. Developers react to demand. Construction projects reserve sites and assemble structures. Repeated travel creates movement corridors. The city expands through active simulation chunks rather than through a fixed maximum map.

The central fantasy is:

> Give a virtual society a few high-level incentives, then watch it organize itself into a functioning city.

The city must remain interesting to watch between decisions. Commutes, service visits, construction, queues, relocations, expansion, and redevelopment should create continuous visible consequences.

---

## 2. Design Priorities

1. **Immediate visible consequences**  
   A purchase should cause a visible change in movement, construction, land use, or agent decisions.

2. **Emergent city form**  
   Layout should result from seeds, demand, access, citizen schedules, and developer decisions rather than fixed plans.

3. **Minimal micromanagement**  
   The player does not draw roads, approve normal buildings, assign citizens, or tune numeric quantities.

4. **Gradual conceptual progression**  
   The game introduces one major system at a time. New systems remain hidden until their fixed prerequisites are met.

5. **Meaningful run identity**  
   Research depth, specialization choices, seed topology, procedural conditions, and Kernel loadouts should create different viable runs.

6. **Deep paths beat shallow generalism in their domain**  
   A generalist remains flexible, but high research ranks unlock capabilities that cannot be reproduced by buying many shallow upgrades.

7. **High explainability**  
   Important autonomous decisions expose plain-language reasons and relevant overlays.

8. **Low physics emphasis**  
   The authoritative simulation uses deterministic fixed logical steps. Rendering interpolates but never affects outcomes.

9. **Scalability from the start**  
   The world expands through chunks. Simulation and rendering work should scale with active entities, dirty chunks, and visible chunks rather than coordinate extent.

10. **Mouse- and touch-only play**  
    Core play requires no keyboard input, text entry, numeric steppers, or repeated plus/minus controls.

---

## 3. Core Gameplay Loop

1. Citizens attempt scheduled activities.
2. Completed activities generate **Data**.
3. Space, Access, Activity, demand, congestion, and underuse reveal the city’s current problems.
4. The player chooses one action:
   - place or relocate a district seed, or
   - purchase a Core Protocol or research-track advancement.
5. Developers, citizens, construction, and movement systems react.
6. The city gains capacity, changes shape, or changes behavior.
7. New scale creates a new problem.
8. The player reaches fixed progression milestones.
9. Late in the run, the player validates the city and recompiles the simulation for permanent metaprogression.

A decision should create a chain of autonomous effects rather than a single isolated modifier.

---

## 4. Current Simulation Foundation

### 4.1 Fixed-step authority — Implemented

The simulation is authoritative and advances only through logical steps.

- Rendering frame rate does not affect simulation outcomes.
- Citizens move by no more than one logical cell per simulation tick.
- Random behavior uses explicit seeded state.
- Simulation snapshots are detached and serializable.
- Rejected commands do not mutate authoritative state.

### 4.2 Chunked world — Implemented

The world uses signed logical coordinates divided into active chunks.

- Inactive chunks are not part of ordinary simulation space.
- Ordinary snapshots expose active-chunk summaries rather than a dense maximum rectangle.
- Detailed demand cells are queried through bounded chunk or region requests.
- Chunk ordering and demand-cell ordering are deterministic.
- Future worlds may extend beyond `1000 × 1000` logical coordinates without allocating every cell in the bounding rectangle.

### 4.3 Building footprints and entrances — Implemented

Initial footprints are:

| Building type |             Footprint |
| ------------- | --------------------: |
| Home          | `3 × 3` logical cells |
| Workplace     | `5 × 5` logical cells |

Buildings occupy their complete footprint. Citizens route to valid exterior entrance cells rather than to blocked interiors.

Capacity is an independent balance value. Footprint area does not automatically determine capacity.

### 4.4 Demand — Implemented

The simulation exposes Living, Working, and Services demand.

Demand:

- Is normalized and deterministic.
- Uses aggregate shortage, local saturation, Access pressure, complementary uses, and matching district-seed influence.
- Is stored and recalculated by affected active chunks.
- Uses stable chunk summaries in ordinary snapshots.
- Uses detached bounded detail queries for cell-level overlays and tests.

### 4.5 Developer projects — Implemented foundation

Developer scoring is deterministic and currently supports homes and workplaces.

The implemented normalized score is:

```text
project_score =
    0.30 × local_matching_demand
  + 0.35 × matching_seed_influence
  + 0.10 × complementary_use
  + 0.10 × entrance_accessibility
  + 0.15 × expected_access_improvement
  - 0.15 × same_use_saturation
  - 0.05 × construction_cost
```

The score is clamped to `[0, 1]` and rounded to six decimal places.

Candidate tie-breaking is:

1. Higher score.
2. Higher matching seed influence.
3. Higher expected Access improvement.
4. Lower footprint `y`.
5. Lower footprint `x`.
6. Stable building-type order.
7. Stable entrance order.

No randomness is used in the score or tie-breaker.

### 4.6 Construction — Implemented

Projects reserve their complete footprint and progress through:

1. Survey
2. Blueprint
3. Foundation
4. Frame
5. Completion

Default phase durations are:

| Phase      | Logical ticks |
| ---------- | ------------: |
| Survey     |             2 |
| Blueprint  |             3 |
| Foundation |             4 |
| Frame      |             6 |
| Completion |             1 |

Total default construction duration is 16 logical ticks.

Future visual sub-stages may exist inside renderer animation, but they must not create additional authoritative construction phases unless this contract is revised.

---

## 5. District Seeds

### 5.1 Seed catalog

The complete planned catalog contains exactly six district seed types.

| Contract ID          | Seed          | Status                              | Base cost | Unlock                              |
| -------------------- | ------------- | ----------------------------------- | --------: | ----------------------------------- |
| `SEED-LIVING`        | Living        | Implemented                         |   10 Data | Bootstrap                           |
| `SEED-WORKING`       | Working       | Implemented                         |   12 Data | Bootstrap                           |
| `SEED-SERVICES`      | Services      | Implemented domain; locked behavior |   20 Data | Services Core                       |
| `SEED-LEARNING`      | Learning      | Contracted                          |   40 Data | Choose Learning specialization      |
| `SEED-INDUSTRY`      | Industry      | Contracted                          |   45 Data | Choose Industry specialization      |
| `SEED-ENTERTAINMENT` | Entertainment | Contracted                          |   40 Data | Choose Entertainment specialization |

There are no Transit or Research district seeds.

- Transit emerges from route usage plus Access research.
- Research-oriented development emerges from Learning, Working, and later specialization interactions.
- Mixed-use development emerges from overlapping activity influence plus Space research.

### 5.2 Shared seed contract

Every district seed:

- Has a stable authoritative ID.
- Has one type, one anchor cell, and one placement tick.
- Must be placed in an active buildable chunk.
- Must not share its anchor cell with another seed.
- Does not directly place a building.
- Adds only matching-type influence.
- Uses deterministic influence, rounding, and iteration order.
- Consumes no RNG when placed, moved, or rejected.
- Appears in the Seed Influence overlay.
- Exposes a plain-language explanation of the uses it encourages.

Different seed types may overlap.

Same-type influences add together and cap at `1`.

### 5.3 Influence — Implemented

The current seed influence uses Manhattan distance.

For a matching seed:

```text
single_seed_influence =
    max(0, 1 - manhattan_distance / influence_radius)
```

Matching contributions add, cap at `1`, and round to six decimal places.

The configured radius is authoritative simulation balance data. UI previews must read the authoritative value rather than duplicate it.

### 5.4 Gentle exponential placement cost — Contracted

The cost of the next seed of a type is:

```text
placement_cost(type) =
    ceil(base_cost(type) × 1.25 ^ active_same_type_seed_count)
```

The first seed uses exponent `0`.

Examples for Living:

| Existing Living seeds | Next Living cost |
| --------------------: | ---------------: |
|                     0 |               10 |
|                     1 |               13 |
|                     2 |               16 |
|                     3 |               20 |
|                     4 |               25 |
|                     5 |               31 |
|                     6 |               39 |

Only active seeds of the same type affect the exponent. Different seed types do not increase one another’s cost.

The existing fixed 10/12/20 costs represent the first seed of each implemented type.

### 5.5 Placement rejection

A seed-placement command rejects when:

- The type is locked.
- The anchor is outside active space.
- The anchor is not buildable.
- Another seed already occupies the anchor.
- The player lacks Data.
- Another explicit future placement rule fails.

A rejected command changes none of:

- Data
- seed collection
- ID counters
- RNG state
- demand revisions
- snapshots
- determinism hash

### 5.6 Seed relocation — Contracted

Seed relocation unlocks with Traffic Analysis.

Relocation:

- Is an atomic simulation command.
- Keeps the seed’s stable ID.
- Validates the destination using placement rules.
- Does not refund the original placement cost.
- Costs:

```text
relocation_cost(type) =
    ceil(
      base_cost(type)
      × 1.25 ^ max(0, active_same_type_seed_count - 1)
      × 0.50
    )
```

- Removes old influence and adds new influence in the same state transition.
- Does not create a moment when both anchors are active.
- Is mutation-free on rejection.

Seeds cannot be deleted for a refund.

---

## 6. Citizens, Buildings, and Movement

### 6.1 Citizen foundation

Citizens have:

- A stable ID.
- A home.
- A job, school, or other primary assignment when the relevant system exists.
- A current activity.
- A route and route progress.
- Activity timers.
- Needs unlocked by progression.
- Limited deterministic state needed for destination choice and schedule adaptation.

The simulation does not expose arbitrary personality statistics before they affect an implemented decision.

### 6.2 Activity progression

Activities unlock in this order:

| Core stage            | Activities introduced                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| Bootstrap             | Home, commute, work                                                    |
| Services              | Eat and basic service use                                              |
| Traffic Analysis      | Waiting and route-delay response                                       |
| Transit               | Walk-to-stop, wait, ride, transfer                                     |
| Specialization        | Learn, Produce/Deliver, or Recreate depending on chosen specialization |
| Verticality           | Vertical circulation and multi-level destinations                      |
| Megacity Coordination | Coordinated multi-stop plans and predictive adaptation                 |

A system must not create demand for an activity before a valid destination and completion path exist.

### 6.3 Destination choice

When multiple valid destinations exist, citizens use a deterministic utility score with explicit weights:

```text
destination_score =
    need_value
  + preference
  + quality
  - route_cost
  - expected_wait
  - price_cost
```

Each implemented activity must define:

- Candidate destinations.
- Normalization of every term.
- Weights.
- Tie-breaking.
- Failure behavior.
- Player-facing primary reason.

Agents must not invent a generic all-purpose destination planner without an explicit task.

### 6.4 Buildings

Building categories are unlocked by research and specialization.

Initial implemented categories:

- Home
- Workplace

Contracted categories:

- Apartment
- Larger workplace
- Food service
- General service
- Mixed-use building
- Learning facility
- Industrial facility
- Entertainment venue
- Vertical variants
- Transit-support structures

Each building contract must define:

- Footprint
- Entrance rules
- Capacity
- Compatible activities
- Developer eligibility
- Construction cost normalization
- Upgrade or conversion prerequisites
- Occupancy rules
- Explanation text

### 6.5 Movement and infrastructure

The player does not draw roads.

Movement infrastructure evolves through:

```text
informal route
→ walkway
→ street or service corridor
→ bus corridor
→ high-capacity transit
```

Progression rules:

- Route usage is measured before infrastructure upgrades exist.
- Congestion-aware route choice requires Access research.
- Immediate citizen conflict resolution uses deterministic movement reservations, not global permanent blocking.
- Transit corridors require both qualifying traffic and the relevant Core/Access research.
- High-capacity transit cannot appear before Access rank 5.

---

## 7. Player Understanding

### 7.1 Primary indicators

The main interface exposes only:

- **Space** — whether sufficient compatible capacity exists.
- **Access** — whether citizens can reach activities efficiently.
- **Activity** — whether citizens and buildings are productively used.

All three are normalized to `[0, 1]`.

Detailed diagnostics may exist in inspection panels and development tools, but progression and explanations should use these three terms consistently.

### 7.2 Overlays

Overlays unlock only with their mechanic:

| Overlay                | Unlock                               |
| ---------------------- | ------------------------------------ |
| Space demand           | Bootstrap                            |
| Seed influence         | First seed placement                 |
| Building activity      | First completed building             |
| Travel flow            | Traffic Analysis                     |
| Transit network        | Transit                              |
| Specialization demand  | Matching specialization              |
| Redevelopment forecast | Space 6 or Activity 5, as applicable |

Only one major overlay is active at a time.

### 7.3 Explanations

Inspection panels show the primary reason, not an unexplained raw score.

Citizen:

- Current activity
- Next destination
- Primary destination reason
- Unmet need
- Current delay or wait
- Follow control

Building:

- Purpose
- Occupancy and capacity
- Relevant local demand
- Why it was built, upgraded, moved, or converted
- Recent activity

Seed:

- Type
- Current placement cost for another seed of that type
- Influence radius
- Matching uses encouraged
- Local influence strength

Route:

- Usage
- Congestion
- Average trip contribution
- Current infrastructure class
- Next eligible upgrade and missing prerequisite

Research:

- Exact mechanical effect
- Prerequisites
- Base or delayed cost
- Visible consequence
- Whether it resets on recompilation

---

## 8. Data Economy

### 8.1 Single run resource

The player manages one run resource: **Data**.

The simulation may internally model costs or viability, but the player does not directly manage money, materials, taxes, or construction budgets.

### 8.2 Generation

Data is generated by completed activities.

```text
data_generated =
    completed_activity_value
  × city_efficiency_factor
```

The efficiency factor is derived from Space, Access, and Activity and is bounded so a weak city continues to progress.

Every activity contract must define its base Data value.

Implemented work generation remains authoritative until revised by an explicit economy task.

### 8.3 Spending

Data is spent on:

- District seed placement
- District seed relocation
- Core Protocols
- Research-track advancements
- Explicit future run actions approved by this document

The player never buys arbitrary quantities through numeric selectors.

### 8.4 Research menu size

The Research screen shows at most four primary purchase cards:

- The next eligible Core Protocol, when available.
- The next relevant Space purchase.
- The next relevant Access purchase.
- The next relevant Activity purchase.

Additional delayed research is accessed through one secondary “Available Research” view. It must not overwhelm the default screen.

---

## 9. Research and Strict Progression

### 9.1 Progression model

Progression has two layers:

1. **Core Protocols** introduce major systems in a fixed order.
2. **Research tracks** let the player deepen Space, Access, or Activity.

Core order is fixed. Research depth is player-directed.

There are six Core tiers after Bootstrap.

| Tier | Core Protocol         | New major concept                                      |
| ---: | --------------------- | ------------------------------------------------------ |
|    0 | Bootstrap             | Living, Working, homes, workplaces, walking, work Data |
|    1 | Services Core         | Needs and destination selection                        |
|    2 | Traffic Analysis      | Route usage, congestion visibility, seed relocation    |
|    3 | Transit Core          | Autonomous transit corridors and multimodal trips      |
|    4 | Specialization Core   | First specialized activity and seed                    |
|    5 | Vertical Simulation   | Second specialization and vertical development         |
|    6 | Megacity Coordination | Predictive coordination and recompilation eligibility  |

Core Protocols cannot be skipped in a normal run.

### 9.2 Core costs

| Core                  | Data cost |
| --------------------- | --------: |
| Services Core         |        50 |
| Traffic Analysis      |       150 |
| Transit Core          |       450 |
| Specialization Core   |     1,200 |
| Vertical Simulation   |     3,200 |
| Megacity Coordination |     8,000 |

Kernel effects may reduce effective cost. Effective cost is always rounded up and cannot fall below 50% of the table value.

### 9.3 Core milestones

Core eligibility requires all listed state conditions.

#### Services Core

- At least one Living seed placed.
- At least one Working seed placed.
- Population at least 20.
- At least 40 completed work activities.

#### Traffic Analysis

- Services Core purchased.
- At least one Services seed placed.
- At least 30 completed service activities.
- Population at least 40.
- At least 100 completed trips.

#### Transit Core

- Traffic Analysis purchased.
- At least 300 completed trips.
- At least one route edge reaches 25 traversals within the authoritative traffic-history window.
- Population at least 75.

#### Specialization Core

- Transit Core purchased.
- At least 100 completed transit rides.
- Population at least 150.
- At least 10 occupied buildings.

#### Vertical Simulation

- Specialization Core purchased.
- At least 100 activities from the first specialization.
- Population at least 300.
- At least 20 occupied buildings.
- At least 3 chunk activations beyond the initial active region.

#### Megacity Coordination

- Vertical Simulation purchased.
- Population at least 600.
- At least 1,500 total completed activities.
- At least 35 occupied buildings.
- At least 6 chunk activations beyond the initial active region.

No Core milestone may require:

- A fixed number of elapsed ticks.
- Real-world time.
- Keeping the game open.
- Owning a system for a minimum duration.

Future Kernel effects may reduce numeric thresholds. A reduced threshold is rounded up.

### 9.4 Track focus and delayed availability

Each Core tier from 1 through 6 unlocks one new rank in each track.

When a Core Protocol is purchased:

1. The player selects one eligible track as the tier’s **Research Focus**.
2. That tier’s rank in the chosen track receives **Focused** pricing.
3. The same tier’s ranks in the other two tracks receive **Delayed** pricing.
4. All three ranks remain available for the rest of the run.
5. A rank still requires the prior rank in its track.
6. A delayed rank may be purchased at any later point after its prerequisite is owned.
7. Focus status is permanent for that rank during the run.

This allows catch-up while strongly rewarding a deep path.

### 9.5 Track costs

Base costs by rank:

| Rank | Base cost |
| ---: | --------: |
|    1 |        30 |
|    2 |        90 |
|    3 |       250 |
|    4 |       700 |
|    5 |     1,800 |
|    6 |     4,500 |

Focused cost:

```text
focused_cost(rank) = base_cost(rank)
```

Delayed cost:

```text
delayed_cost(rank) = ceil(base_cost(rank) × 2.50)
```

Kernel effects may reduce both costs. Effective research cost is rounded up and cannot fall below 50% of the applicable focused or delayed value.

The focused rank from the current tier must be purchased before the next Core Protocol can be purchased.

Delayed ranks are optional.

### 9.6 Space track

| Rank | Contract ID | Upgrade                  | Fixed effect                                                                                                                                                                         |
| ---: | ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|    1 | `SPACE-1`   | Apartments               | Developers may construct dense residential buildings when local Living demand is at least `0.60` and expected occupancy is at least `75%`.                                           |
|    2 | `SPACE-2`   | Adaptive Density         | Residential and workplace candidate generation may choose small or dense forms based on demand, saturation, and Access instead of using one form per type.                           |
|    3 | `SPACE-3`   | Mixed Use                | Developers may construct compatible Living/Services or Working/Services mixed-use buildings where both matching local demands are at least `0.50`.                                   |
|    4 | `SPACE-4`   | Vertical Neighborhoods   | Dense and mixed-use buildings may add vertical capacity modules instead of requiring a new footprint when local demand is at least `0.70`.                                           |
|    5 | `SPACE-5`   | Satellite Development    | Developer evaluation may begin a disconnected satellite cluster in an activated region when central buildable capacity is constrained and a specialization or service anchor exists. |
|    6 | `SPACE-6`   | Predictive Redevelopment | Developers may coordinate conversion, merging, and replacement using forecast demand and Access rather than responding only after failure.                                           |

### 9.7 Access track

| Rank | Contract ID | Upgrade                     | Fixed effect                                                                                                                                            |
| ---: | ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | `ACCESS-1`  | Better Job Matching         | New citizens choose compatible home/work assignments using route cost, then stable building ID, rather than first available capacity.                   |
|    2 | `ACCESS-2`  | Congestion-Aware Routing    | Long-range route cost includes bounded historical congestion. Current citizen positions remain local reservation concerns, not static global obstacles. |
|    3 | `ACCESS-3`  | Coordinated Transfers       | Citizens may combine walking and transit legs and evaluate transfer wait in destination cost.                                                           |
|    4 | `ACCESS-4`  | Express Corridors           | High-use transit corridors may skip local stops and form a route hierarchy when both local and express demand thresholds are met.                       |
|    5 | `ACCESS-5`  | High-Capacity Transit       | Qualifying express corridors may upgrade to high-capacity transit with greater throughput and higher construction requirements.                         |
|    6 | `ACCESS-6`  | Predictive Network Planning | The simulation may reserve or upgrade corridors based on forecast movement demand before sustained gridlock occurs.                                     |

### 9.8 Activity track

| Rank | Contract ID  | Upgrade                 | Fixed effect                                                                                                                       |
| ---: | ------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
|    1 | `ACTIVITY-1` | Schedule Chaining       | A citizen may travel directly from one completed out-of-home activity to the next valid activity instead of always returning home. |
|    2 | `ACTIVITY-2` | Staggered Schedules     | Citizens with repeated delay may choose an earlier or later deterministic departure band.                                          |
|    3 | `ACTIVITY-3` | Business Relocation     | Persistently underused service or specialized businesses may relocate to a better valid site instead of only closing.              |
|    4 | `ACTIVITY-4` | Multi-Stop Plans        | Citizens may form deterministic plans containing up to three out-of-home destinations before returning home.                       |
|    5 | `ACTIVITY-5` | Demand Forecasting      | Developers and businesses may use forecast activity demand when evaluating capacity and location.                                  |
|    6 | `ACTIVITY-6` | Autonomous Coordination | Schedules, destination capacity, construction timing, and service availability may coordinate through a shared forecast horizon.   |

### 9.9 Research-depth intent

Expected run profiles include:

- `6/0/0` specialist
- `5/1/0` deep specialist
- `4/1/1` focused
- `3/3/0` hybrid
- `2/2/2` generalist

A specialist pays focused price for its defining ranks and reaches transformative behavior earlier in its domain.

A generalist may purchase all available ranks but pays delayed cost for most of them.

No track may be replaced by a generic percentage-only ladder.

---

## 10. Specializations

### 10.1 Choice schedule

At Specialization Core:

- Choose exactly one of Learning, Industry, or Entertainment.
- The matching seed, demand, buildings, and activity unlock.
- The choice is permanent for the run.

At Vertical Simulation:

- Choose one of the two remaining specializations.
- The matching systems unlock.
- The third specialization remains unavailable for that run.

A normal run never unlocks all three specializations.

### 10.2 Learning specialization

Unlocks:

- Learning seed.
- Learning demand.
- Learn activity.
- School and campus development.
- Education completion Data.
- Skilled-job compatibility for future job contracts.

### 10.3 Industry specialization

Unlocks:

- Industry seed.
- Industry demand.
- Produce and Deliver activities.
- Workshop, production, and logistics development.
- Freight or delivery traffic.
- Production completion Data.

### 10.4 Entertainment specialization

Unlocks:

- Entertainment seed.
- Entertainment demand.
- Recreate activity.
- Venue and entertainment-complex development.
- Evening and off-peak travel patterns.
- Recreation completion Data.

---

## 11. Expansion

The world expands by activating chunks.

- Activation is authoritative and deterministic.
- Only active chunks contain ordinary buildable or walkable space.
- Expansion allocates only activated chunks.
- A distant coordinate does not allocate the rectangle between it and existing chunks.

At defined milestones the player may choose:

- **Expand Outward**
- **Expand Upward**
- **Start Satellite District**

The exact Data cost and automatic-expansion thresholds remain Deferred until chunk activation, developer expansion, and population growth are balanced together.

Agents must not invent those costs before that task.

---

## 12. Recompilation and Permanent Progression

### 12.1 Player-facing name

The prestige action is called **Recompile Simulation**.

### 12.2 Availability

Recompilation is manual and never forced.

It becomes available when:

- Megacity Coordination is purchased.
- The prestige-scaled population target is met.
- The prestige-scaled completed-activity target is met.
- The prestige-scaled active-chunk target is met.
- Space is at least `0.65`.
- Access is at least `0.65`.
- Activity is at least `0.60`.
- One Validation objective is complete.
- The simulation has no critical invalid or permanently stalled state.

There is no elapsed-time or tick-count requirement.

### 12.3 Prestige-scaled targets

Let `P` be the current Prestige Level before recompiling.

```text
population_target(P) =
    600 + 250P + 50P²

completed_activity_target(P) =
    1,500 + 1,000P + 200P²

active_chunk_target(P) =
    16 + 2P
```

### 12.4 Validation objectives

The player completes one Validation per run.

#### Space Validation

- Space at least `0.80`.
- Housing and job capacity each at least `125%` of population.
- At least `ceil(10 × (1 + 0.10P))` occupied dense, mixed-use, vertical, or satellite buildings.

#### Access Validation

- Access at least `0.80`.
- At least `ceil(500 × (1 + 0.15P))` completed transit rides.
- No critical route remains above the contracted severe-congestion threshold.

#### Activity Validation

- Activity at least `0.75`.
- Occupied-building ratio at least `0.80`.
- At least `ceil(500 × (1 + 0.15P))` completed specialization activities.

### 12.5 Reset boundary

Recompilation resets:

- World and active chunks
- Citizens
- Buildings and projects
- District seeds
- Data
- Core Protocols
- Research ranks and focus selections
- Specializations
- Route and congestion history
- Run-specific counters and milestones

Recompilation preserves:

- Prestige Level
- Kernel Capacity
- Unspent Kernel Points
- Permanently purchased Kernel Modules
- Permanent Kernel Optimization ranks
- Cosmetics
- Settings and accessibility preferences

The game is not required to preserve past city summaries, screenshots, time-lapses, or replay archives.

### 12.6 Reward every prestige

Every recompilation grants:

- Prestige Level `+1`
- Kernel Capacity `+1`
- One unrestricted Kernel Point
- One Validation Kernel Point that must be spent in the selected Validation branch
- One additional unrestricted Kernel Point when the new Prestige Level is divisible by `5`

### 12.7 Kernel Matrix

The Kernel Matrix has four branches:

- Bootstrap
- Space
- Access
- Activity

Major Kernel Modules:

- Are purchased permanently.
- Cost one Kernel Point unless stated otherwise.
- Must be equipped before a run.
- Consume Kernel Capacity.
- Cannot be changed during a run.
- May be rearranged freely before a new run.

### 12.8 Repeatable Kernel Optimizations

After purchasing all six major modules in a branch, that branch unlocks repeatable permanent optimizations.

Repeatable optimizations:

- Cost one Kernel Point per rank.
- Are always active.
- Do not consume Kernel Capacity.
- Have diminishing returns.
- Never reach their asymptotic floor at a finite rank.

Representative contracted formulas:

```text
core_cost_factor(r) =
    0.50 + 0.50 × 0.95^r

construction_duration_factor(r) =
    0.50 + 0.50 × 0.95^r

seed_growth_factor(r) =
    1.15 + 0.10 × 0.95^r

core_threshold_factor(r) =
    0.60 + 0.40 × 0.95^r

research_cost_factor(r) =
    0.50 + 0.50 × 0.95^r

validation_count_factor(r) =
    0.60 + 0.40 × 0.95^r
```

All factors are rounded to six decimal places before use.

---

## 13. Touch-Only Interface

Persistent controls:

- **Build**
- **Research**
- **City**
- **View**
- **Speed**

The Research screen presents:

- Next Core Protocol or its missing requirements.
- Current-tier Space option.
- Current-tier Access option.
- Current-tier Activity option.

Delayed research appears in a secondary view.

Recompile requires explicit confirmation because it resets the run.

---

## 14. Balance-Test Apparatus

The headless runner must test:

- Seed type and placement value
- Exponential seed-cost pressure
- Focused versus delayed research
- Specialist, hybrid, and generalist paths
- Core milestone pacing
- Specialization combinations
- Recompilation target scaling
- Kernel module combinations
- Repeatable optimization progression
- Recovery from poor layouts
- Long-run determinism and invariants

Ticks may be measured for balance comparison. Ticks are not permitted as fixed unlock requirements.

---

## 15. Recommended MVP

The first complete playable progression slice should contain:

- Living, Working, and Services seeds
- Services Core
- One tier-1 Research Focus
- Space 1: Apartments
- Access 1: Better Job Matching
- Activity 1: Schedule Chaining
- Home, work, and service activities
- Developer construction
- Population growth
- Chunk activation
- Deterministic scenario runner

Recompilation is not part of the MVP implementation. Its contract exists now so earlier systems do not block it later.

---

## 16. Design Summary

Idle City has two recurring player actions:

1. Place district seeds.
2. Purchase research.

The six seed types are:

- Living
- Working
- Services
- Learning
- Industry
- Entertainment

Research has:

- Six fixed Core Protocols
- Six Space ranks
- Six Access ranks
- Six Activity ranks
- One focused rank per Core tier
- Permanently available delayed ranks at `2.50×` cost
- One specialization at Core 4
- A second specialization at Core 5
- No third specialization in the same run

Each recompilation:

- Resets the city and run research.
- Increases Prestige Level and Kernel Capacity.
- Grants unrestricted and branch-aligned Kernel Points.
- Expands a permanent Kernel Matrix.
- Supports ongoing progression through repeatable diminishing-return optimizations.

The intended long-term loop is:

> Observe a need, place an influence or deepen a research path, watch the city reorganize, validate the resulting megacity, then recompile with a stronger and more specialized simulation kernel.
