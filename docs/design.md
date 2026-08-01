# Virtual Crowd-Built City

## 1. Concept

A touch-friendly incremental game about operating a visibly artificial, voxel-based city simulation.

The player does not place individual buildings, roads, or citizens. Instead, the player occasionally places broad **district seeds** and purchases **simulation upgrades**. AI citizens follow daily schedules, developers react to demand, and construction bots continuously build, upgrade, convert, and connect the city.

The central fantasy is:

> Give a virtual society a few high-level incentives, then watch it organize itself into a functioning city.

The city should be interesting to watch even when the player is not making decisions. Morning commutes, shop visits, deliveries, construction, relocations, and nighttime activity should produce a constant visual spectacle.

---

## 2. Design Priorities

1. **Immediate visual satisfaction**  
   Purchases should quickly cause visible movement, construction, or reorganization.

2. **Emergent behavior**  
   City form should result from citizen schedules, demand, and developer decisions rather than fixed layouts.

3. **Low physics emphasis**  
   The simulation uses discrete fixed steps. Movement is between graph nodes or voxel cells, with animation tweened between logical states.

4. **High AI emphasis**  
   Citizens and developers make most local decisions. Progress increasingly improves their planning ability.

5. **Minimal micromanagement**  
   The player shapes broad spatial incentives and selects upgrades, but does not manage individual agents or buildings.

6. **High player understanding**  
   Important behavior must be visually explainable. The player should know what is wrong, why construction occurred, and how a purchase changed the city.

7. **Low art requirement**  
   Citizens, vehicles, buildings, and construction effects should be built from simple voxel forms, icons, lights, and procedural animation.

8. **Mouse- and touch-only controls**  
   All actions use tapping, clicking, dragging, cards, and large buttons. No keyboard input or numeric amount controls are required.

---

## 3. The Two Player Actions

The game is built around only two recurring actions.

### 3.1 Place a District Seed

A district seed is a player-placed influence point. It encourages a kind of activity nearby but does not directly place buildings.

The three starting seed types are:

- **Living** — encourages homes and population growth.
- **Working** — encourages workplaces and job creation.
- **Services** — encourages food, shopping, and basic leisure.

Later upgrades may unlock additional specialized seeds:

- Learning
- Entertainment
- Industry
- Transit
- Research

A seed influences a broad radius. Developers decide the exact building types, sizes, and positions within that area.

A Living seed near a Working seed may create a compact mixed neighborhood. Placing them far apart may create a commuter city. Several separated seed clusters may produce a polycentric city. Placing seeds in a line may create a linear city.

This gives the player meaningful spatial influence without requiring zoning or road drawing.

### 3.2 Buy a Simulation Upgrade

The player spends Data to unlock one new capability or improve autonomous behavior.

Examples:

- Apartments
- Mixed-use buildings
- Buses
- Education
- Recreation
- Delivery services
- Better job matching
- Better demand forecasting
- Business relocation
- Automatic redevelopment
- Coordinated travel
- Vertical construction

Upgrades should usually change visible behavior rather than merely apply a hidden percentage bonus.

Good upgrade:

> Developers may replace small homes with apartments when local housing demand is high.

Weak upgrade:

> Housing output +10%.

Numerical modifiers may support visible upgrades, but should not be the primary reward.

---

## 4. Core Gameplay Loop

1. Citizens follow their schedules.
2. Their completed activities generate **Data**.
3. Demand, congestion, or underuse becomes visible.
4. The player chooses one purchase:
   - place a district seed, or
   - buy a simulation upgrade.
5. Developers and citizens react.
6. Construction, movement, and city structure visibly change.
7. The improved city supports more citizens and more complex schedules.
8. New problems and opportunities appear.

A typical short session might look like this:

1. The player opens the city during the morning commute.
2. Many citizens travel across town for food after work.
3. Red travel trails show that the western residential area lacks services.
4. The purchase menu offers:
   - Place Services Seed
   - Research Buses
   - Research Mixed-Use Buildings
5. The player places a Services seed in the western district.
6. Developers propose a grocery shop and café.
7. Construction bots assemble both buildings.
8. Nearby citizens alter their schedules.
9. Travel distance falls, foot traffic rises, and new homes appear nearby.
10. The resulting activity generates Data toward the next purchase.

One simple decision should create a chain of autonomous consequences.

---

## 5. City Simulation

## 5.1 Citizens

Citizens are discrete agents with:

- A home
- A job or school
- A daily schedule
- A small set of needs
- Preferred destinations
- A current route
- A limited memory of recent success or failure

An early citizen schedule may be:

1. Leave home.
2. Travel to work.
3. Work.
4. Visit a food service.
5. Return home.
6. Sleep.

Later upgrades add:

- Education
- Recreation
- Social visits
- Shopping
- Remote work
- Tourism
- Household routines

Citizens choose destinations using a simple utility score:

```text
destination_score =
    need_value
  + preference
  + quality
  - travel_cost
  - expected_wait
  - price_cost
```

The score need not be exposed numerically to the player. The game should explain the main reason for a choice in plain language.

## 5.2 Developers

Developers periodically evaluate unmet demand and propose projects.

A simple project score may be:

```text
project_score =
    local_demand
  + seed_influence
  + nearby_activity
  + access
  + complementary_uses
  - construction_cost
  - competition
  - congestion
```

Developers handle:

- Exact building placement
- Building type selection
- Building size
- Construction timing
- Expansion
- Conversion
- Demolition
- Redevelopment

The player never approves ordinary projects.

## 5.3 Buildings

Buildings use modular voxel shells and a small number of functional types.

Starting types:

- Small home
- Apartment
- Workshop
- Office
- Food shop
- General service building

Later types can remain combinations of the same modules rather than requiring unique art.

Buildings may autonomously:

- Expand upward
- Add capacity
- Change use
- Merge with adjacent lots
- Become mixed-use
- Shut down
- Be replaced

When a major change occurs, the game briefly displays the reason:

> Upgrading to apartments because 38 citizens are seeking nearby housing.

## 5.4 Paths and Transit

The player does not place roads.

Citizens initially travel along direct grid paths. Repeated travel increases a route's usage score. Infrastructure upgrades automatically emerge:

```text
informal route
→ walkway
→ street
→ bus route
→ high-capacity transit
```

The upgrade depends on traffic type and researched technology.

Examples:

- Dense pedestrian traffic creates wider walkways.
- Delivery traffic encourages service streets.
- Repeated long commutes create bus demand.
- Extremely busy routes may later become rail or portal links.

This makes the transport network a visible result of citizen behavior and seed placement.

## 5.5 Construction

Construction is a major visual reward.

A project progresses through discrete states:

1. Survey
2. Holographic blueprint
3. Foundation
4. Voxel frame
5. Functional modules
6. Exterior completion
7. Occupancy

Construction bots tween between logical positions, carry glowing voxel blocks, and assemble structures layer by layer.

Large projects should be staged long enough to be enjoyable to watch without slowing progression excessively.

---

## 6. Player Understanding

The simulation must remain understandable despite autonomous behavior.

## 6.1 Three Primary City Indicators

The main interface tracks only three city-wide concerns.

### Space

Are enough homes, jobs, and services available?

Visible signs:

- Demand icons above crowded areas
- Citizens failing to find destinations
- Full buildings
- Construction interest

### Access

Can citizens reach scheduled activities efficiently?

Visible signs:

- Long red travel trails
- Queues
- Crowded paths
- Missed activities

### Activity

Are buildings and citizens being productively used?

Visible signs:

- Dim underused buildings
- Empty workplaces
- Idle citizens
- Failed businesses

Detailed metrics may exist in inspection panels and development builds, but the main game should emphasize these three concepts.

The first simulation slice exposes each indicator as a deterministic normalized value from `0` to `1`:

- **Space** is the smaller of housing-capacity coverage and workplace-capacity coverage.
- **Access** compares the average trip duration with the longest possible direct grid trip. Before a trip completes, the planned home-to-work distance is used.
- **Activity** is the share of citizens currently working. Home time is scheduled rest, while commuting is travel rather than productive building use.

The current slice generates Data when a citizen completes a work activity. Each completed activity contributes one activity unit multiplied by a bounded efficiency factor derived from the three indicators. A struggling city still receives at least half value, and generation is rounded to six decimal places so headless summaries remain compact and reproducible.

The simulation also publishes a spatial demand field for the three starting activity kinds: Living, Working, and Services. Each grid cell contains normalized demand, and the snapshot includes aggregate totals. The initial field uses housing and workplace capacity shortage, local building saturation, travel pressure from Access, and nearby complementary uses. District seeds are not implemented yet; their future influence enters through a dedicated demand extension point.

## 6.2 Tap-to-Explain

Tapping an object opens a short explanation.

Citizen:

- Current activity
- Next destination
- Why that destination was selected
- Current unmet need
- Follow button

Building:

- Purpose
- Occupancy
- Current demand
- Why it was built or upgraded
- Recent activity

Seed:

- Type
- Influence area
- Buildings encouraged
- Citizens affected

Route:

- Current traffic
- Average trip
- Next possible infrastructure upgrade

## 6.3 Visual Overlays

The player may select one overlay at a time:

- Space demand
- Travel flow
- Building activity
- Seed influence

These are enough for early play. More specialized overlays should only be added when the corresponding mechanics exist.

## 6.4 Event Summaries

The game periodically calls out meaningful emergent changes:

- A second neighborhood center has formed.
- A new service cluster shortened 54 daily trips.
- The northern district is losing residents because jobs are too distant.
- A busy walkway has upgraded into a bus corridor.
- Developers are converting unused offices into housing.

These summaries help players understand the city's history without reading logs.

---

## 7. Progression

Progression adds one concept at a time.

## Stage 1: Seed Settlement

Available:

- Living seed
- Working seed
- Services seed
- Small buildings
- Walking
- Basic citizen schedules

Purpose:

- Teach how seed placement changes autonomous construction.

## Stage 2: Busy Town

Unlocks:

- Apartments
- Recreation
- Delivery agents
- Improved path upgrades
- Better job matching

Visible change:

- More traffic
- Taller buildings
- Specialized trips
- Denser neighborhoods

## Stage 3: Connected City

Unlocks:

- Buses
- Mixed-use buildings
- Education
- Business relocation
- Automatic building conversion

Visible change:

- Transit flows
- Neighborhood specialization
- More schedule variety
- Active redevelopment

## Stage 4: Vertical Metropolis

Unlocks:

- Towers
- Elevators
- Multi-level paths
- Advanced demand forecasting
- Coordinated construction

Visible change:

- Vertical growth
- Skybridges
- Layered movement
- Major construction projects

## Stage 5: Autonomous Megacity

Unlocks:

- High-capacity transit
- Satellite districts
- Predictive redevelopment
- Advanced citizen planning
- Specialized city sectors

Visible change:

- Multiple city centers
- Large synchronized flows
- Self-correcting neighborhoods
- Continuous large-scale redevelopment

---

## 8. Data Economy

The player manages one resource: **Data**.

Data is earned when citizens successfully complete activities:

- Work
- Eat
- Shop
- Learn
- Socialize
- Travel efficiently
- Use newly unlocked systems

Data income should be influenced by both scale and effectiveness:

```text
data_per_tick =
    completed_activities
  × activity_value
  × city_efficiency_factor
```

The efficiency factor should be bounded so a temporarily inefficient city still progresses.

The simulation snapshot also reports accumulated Data, Data generated during the most recent tick, completed work activities, and average trip duration. These values are authoritative simulation state and are reused by the HUD and balance runner.

The city may internally simulate money, building costs, and business viability, but the player does not directly manage those systems.

The purchase menu should usually present three or four affordable or near-affordable choices. It should avoid long technology trees and quantity selectors.

---

## 9. Spatial Variety Between Runs

Replay variety comes primarily from seed placement and procedural starting conditions.

## 9.1 Procedural Map Variation

A new run may vary:

- Starting platform shape
- Existing obstacles
- Elevation
- Buildable gaps
- Initial resource or activity nodes
- Starting population distribution
- Initial seed position

Maps should remain readable and not require manual terrain editing.

## 9.2 Seed Availability

The order in which specialized seed types appear may vary between runs.

One city may gain Learning early. Another may gain Transit or Entertainment first. This changes development pressure without requiring a large random technology tree.

## 9.3 Player-Created Topology

The player indirectly creates the city shape through seed placement.

Examples:

- Compact cluster
- Long commuter corridor
- Several independent centers
- Dense vertical core
- Ring-shaped development
- Satellite neighborhoods

No explicit topology selection is necessary.

## 9.4 Expansion Choice

Most expansion is automatic. At occasional milestones, the player makes one simple choice:

- **Expand Outward**
- **Expand Upward**

Later, a third option may appear:

- **Start Satellite District**

This preserves occasional macro-level authorship without adding a full land-allocation system.

---

## 10. Prestige

Prestige means archiving the current simulation and starting a new city with one inherited capability.

A run ends when the city reaches a clear milestone, such as:

- A target population
- A target simulation level
- Completion of a major city core
- A late-game research threshold

The archived city remains viewable as a snapshot or short time-lapse.

At prestige, the player selects one permanent trait from a small set.

Examples:

- Start with buses unlocked.
- Developers react faster to demand.
- Paths upgrade with less traffic.
- Residential buildings may grow one level taller.
- Service buildings attract citizens from farther away.
- Begin with an additional district seed.
- Citizens adapt schedules more quickly.
- Construction bots work in larger teams.

Traits should create different early strategies rather than only increase Data income.

At later prestige levels, the player may carry two traits. A large loadout system is unnecessary unless later playtesting shows a need.

---

## 11. Touch-Only Interface

Persistent controls:

- **Build** — available district seeds
- **Research** — upgrade cards
- **City** — three main indicators and milestones
- **View** — overlays and camera focus
- **Speed** — pause, normal, fast, very fast

### Seed placement

1. Tap Build.
2. Tap a seed card.
3. Tap a valid city location.
4. View its influence preview.
5. Tap Confirm or Cancel.

### Research

Research appears as three or four large cards. Each card includes:

- Name
- One-sentence effect
- Visible consequence
- Data cost
- Purchase button

### Camera

- Drag to rotate
- Pinch or wheel to zoom
- Two-finger drag or middle-drag to pan
- Tap to inspect
- Double-tap to follow
- Tap empty space to close panels

No action requires typing or repeated plus/minus inputs.

---

## 12. Visual Direction

The city should unmistakably resemble a virtual environment.

Visual elements:

- Floating voxel terrain in a dark or abstract void
- Visible grid lines
- Holographic construction previews
- Glowing route traces
- Voxel citizens with state lights
- Buildings briefly shown as wireframes when selected
- Data pulses moving through active structures
- New terrain appearing as allocated simulation blocks
- Controlled visual glitches during upgrades
- Simulation diagnostics as diegetic UI
- A wave of light passing through the city when AI behavior is upgraded

Citizens can be tiny geometric figures with a few procedural animations:

- Walk
- Wait
- Enter building
- Carry item
- Ride transit
- Socialize
- Sleep or recharge

Buildings should be assembled from reusable voxel modules rather than unique modeled assets.

---

## 13. Balance-Test Apparatus

The game should have a separate headless runner using the same deterministic simulation core.

Its purpose is to answer:

- Is one seed type consistently better than the others?
- Is one upgrade almost always the correct purchase?
- Do some seed arrangements create runaway growth?
- Does player choice matter more than random variation?
- Are prestige traits meaningfully different?
- Can the simulation recover from poor layouts?
- Are apparently useful options actually ineffective?

## 13.1 Reproducible Runs

Every run is determined by:

- World seed
- Citizen seed
- Developer seed
- Upgrade offer seed
- Player policy
- Prestige trait
- Simulation version

The runner outputs a compact result file and, when needed, a replay log.

Example:

```text
citysim-runner
  --seed 184729
  --policy heuristic
  --prestige faster_developers
  --ticks 100000
  --output result.json
```

Rendering is optional.

## 13.2 Automated Player Policies

Begin with three policies.

### Random Player

Randomly buys an affordable valid seed or upgrade.

Use it to:

- Exercise unusual combinations
- Find invalid states
- Establish a weak baseline

### Heuristic Player

Responds to the largest current problem.

Example:

```text
if Space is critical:
    prefer Living seed or capacity upgrade
elif Access is critical:
    prefer nearby Services seed or transit upgrade
elif Activity is critical:
    prefer Working seed or demand-matching upgrade
else:
    buy the cheapest broadly useful option
```

Use it to approximate normal competent play.

### Greedy Lookahead Player

For each legal purchase:

1. Clone the current state.
2. Apply the purchase.
3. Simulate a short horizon.
4. Score the result.
5. Choose the highest-scoring option.

Use it to detect choices with excessive short-term power.

A more advanced search player can be added later only when the option set becomes large enough to justify it.

## 13.3 Core Metrics

Record a small metric set:

- Population
- Total Data earned
- Average trip duration
- Activity completion rate
- Occupied building count
- Citizen idle time
- City footprint

The primary balance score may combine several metrics for automated comparison, but raw metrics must remain available.

Example development score:

```text
score =
    total_data
  + population_weight × population
  + completion_weight × completed_activities
  - trip_weight × average_trip_duration
  - idle_weight × citizen_idle_time
```

This score is only a testing convenience. It should not replace separate metric analysis.

## 13.4 Paired-Seed Comparison

To compare two options:

1. Save a simulation state where both choices are legal.
2. Clone it.
3. Apply option A to one clone.
4. Apply option B to the other.
5. Continue both with identical future random streams.
6. Compare metrics after short, medium, and long horizons.

Repeat across many states and seeds.

This reveals:

- Immediate value
- Delayed value
- Variance
- Context dependence
- Whether one option dominates another

## 13.5 Testing Seed Placement

Seed balance is spatial, so the runner should test several placement policies:

- Near an existing complementary seed
- Far from existing development
- Near the largest demand cluster
- Near the busiest route
- Random valid location
- Location selected by short lookahead

For each seed type, measure both:

- The value of buying the seed
- The sensitivity to where it is placed

A seed is problematic if it is either useful almost everywhere or useful only in an extremely narrow, hidden condition.

## 13.6 Balance Criteria

Options need not have equal average value. They should have understandable tradeoffs.

Healthy patterns:

- One choice helps immediately; another helps later.
- One choice supports compact cities; another supports expansion.
- One choice is reliable; another is high-variance.
- One choice solves Space; another solves Access.
- Different map shapes favor different options.

Warning signs:

- One option wins in nearly every paired comparison.
- Strong policies always select the same opening sequence.
- An option has no measurable effect.
- One prestige trait dominates every map type.
- Random map variation matters much more than player decisions.
- A bad early seed placement permanently ruins a run.

## 13.7 Development Test Suites

### Per-change smoke test

Run dozens or hundreds of short simulations.

Detect:

- Crashes
- Deadlocks
- Citizens with no valid action
- Buildings that can never fill
- Pathfinding failures
- Numerical explosions

### Nightly balance test

Run thousands of medium simulations.

Report:

- Choice frequencies
- Average option effects
- Metric changes from the previous build
- Common failure states
- Best and worst replay seeds

### Milestone test

Run a larger batch before major releases.

Check:

- Opening strategies
- Prestige traits
- Long-run stagnation
- Dominant seed layouts
- Recovery from poor choices
- Variety of successful city shapes

Every reported outlier should be reproducible in the visual client from its seed and replay log.

---

## 14. Recommended MVP

The first playable build should contain only the following.

### Player actions

- Place Living seed
- Place Working seed
- Place Services seed
- Buy one of three offered upgrades

### Citizen activities

- Live
- Work
- Eat
- Return home

### Autonomous systems

- Destination selection
- Fixed-step path travel
- Developer project selection
- Building construction
- Building occupancy
- Automatic path formation
- Automatic city expansion

### Buildings

- Home
- Apartment
- Workplace
- Food service

### Upgrades

- Apartments
- Faster walking
- Better job matching
- Larger workplaces
- Mixed-use buildings
- Basic buses

### Presentation

- Voxel city
- Day/night activity cycle
- Construction bots
- Travel trails
- Space, Access, and Activity indicators
- Tap-to-explain panels
- Follow-citizen camera

### Balance tools

- Deterministic headless runner
- Random policy
- Heuristic policy
- Greedy short-lookahead policy
- Paired-seed comparison
- JSON metrics and replay output

### Prestige

Prestige should be deferred until the base loop is satisfying. The first implementation can reset to a new procedural map without permanent bonuses. Add inherited traits only after multiple city layouts and upgrade paths are proven to behave differently.

---

## 15. Implementation Order

### Phase 1: Watchable simulation

Build:

- Fixed-step clock
- Citizens and schedules
- Tweened movement
- Homes, jobs, and food services
- Developer construction
- Voxel rendering
- Camera controls
- Time controls

Success condition:

> A small city is pleasant to watch for several minutes without player input.

### Phase 2: Player influence

Add:

- Three district seeds
- Seed influence fields
- Data resource
- Seed purchase and placement
- Three city indicators
- Tap-to-explain panels

Success condition:

> Different seed placements visibly produce different neighborhoods and travel patterns.

### Phase 3: Incremental progression

Add:

- Upgrade cards
- Apartments
- Better matching
- Mixed use
- Path upgrades
- Buses
- Milestones

Success condition:

> A purchase repeatedly produces a clear visible improvement or change.

### Phase 4: Balance runner

Add:

- Headless mode
- Deterministic seeds
- Automated policies
- Metrics
- Paired comparisons
- Replay export

Success condition:

> A developer can compare two options across hundreds of identical scenarios and inspect representative visual replays.

### Phase 5: Replay and prestige

Add:

- More procedural map shapes
- Specialized seeds
- Archived city summaries
- One inherited prestige trait

Success condition:

> Starting a new city produces a meaningfully different optimization problem rather than only repeating the same build order.

---

## 16. Main Design Risks

### The city plays itself

The player may feel unnecessary if seeds and upgrades have weak effects.

Mitigation:

- Make seed placement strongly affect demand fields.
- Present choices tied to visible city problems.
- Show before-and-after consequences.
- Ensure different placements lead to different city structures.

### Autonomous behavior feels arbitrary

Mitigation:

- Expose simple reasons for projects and destination choices.
- Use only four early overlays.
- Keep initial schedules and building types limited.
- Introduce complexity gradually.

### The optimal layout becomes obvious

Mitigation:

- Vary map geometry and initial conditions.
- Use overlapping but nonidentical seed effects.
- Make compactness, access, and growth pull in different directions.
- Test opening placements with paired deterministic simulations.

### Poor choices ruin a run

Mitigation:

- Let developers convert buildings.
- Allow seeds to be moved later at a visible cost.
- Let the city gradually recover from congestion.
- Avoid permanent failure states in ordinary play.

### Visual spectacle disappears at scale

Mitigation:

- Keep construction continuous.
- Aggregate distant agents while retaining representative visible flows.
- Use morning, evening, and event-driven activity waves.
- Focus the camera automatically on major construction and network changes.

---

## 17. Design Summary

The simplified game has one spatial mechanic and one progression mechanic:

1. **Place district seeds** to influence where broad kinds of activity develop.
2. **Buy simulation upgrades** to add capabilities or improve AI behavior.

Everything else is autonomous:

- Building placement
- Road and path formation
- Construction
- Citizen schedules
- Business location
- Redevelopment
- City expansion

Replay variety comes from:

- Procedural map shapes
- Different seed placement
- Different upgrade order
- Occasional outward-versus-upward expansion choices
- A small prestige trait system added later

The resulting core loop is:

> Observe a visible need, place one influence or unlock one capability, then watch the simulated city reorganize itself.

This preserves spatial strategy, emergent behavior, player understanding, and visual spectacle while keeping the interaction model simple enough for an incremental game.
