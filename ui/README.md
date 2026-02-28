# CrowdFlow Simulator

A browser-based, agent-driven crowd simulation for estimating maximum safe capacity of an event venue.

## Quick Start

```bash
cd simulation
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

---

## How to Run Your First Simulation

1. **Open the app** – the default *Concert Hall* sample venue loads automatically.
2. **Switch to the Simulation tab** (top nav).
3. **Set N** – use the "Total N" slider in the right panel (default: 500).
4. **Click ▶ Run** – agents spawn at the two top entrances and walk toward the Stage, Bars, and WCs.
5. **Watch the heatmap** – density colours shift from green → orange → red as areas crowd.
6. **Enable Evacuation** – check "Enable evacuation" in the controls panel. Agents will switch to exits at the configured time.
7. **View metrics** – right panel shows peak density, egress times, queue lengths.
8. **Click ↺ Reset** to restart with the same or modified parameters.

---

## Venue Editor

Switch to the **✏ Venue Editor** tab to design your own floor plan:

| Tool | Action |
|------|--------|
| Wall | Click + drag to draw a rectangular obstacle |
| Entrance | Click to place a spawn point (green bar) |
| Exit | Click to place an evacuation exit (red bar) |
| Attractor | Click to place stage / bar / toilet with weight + service time |
| Select | Click to select; **Delete** key removes the element |

- **Snap to grid** keeps everything aligned to a 2 m grid (configurable).
- **Save Venue** / **Upload Venue** export/import the layout as JSON.
- **Load Sample** restores the built-in concert hall.

---

## Simulation Controls

| Parameter | Description |
|-----------|-------------|
| **N** | Total participants |
| **Arrival mode** | Burst (all at once), Linear (steady stream), Gaussian (bell-curve peak) |
| **Arrival duration** | Minutes over which participants arrive |
| **Speed min/mean/max** | Walking speed distribution (m/s); default ≈1.4 m/s (5 km/h) |
| **Personal space** | Repulsion radius between agents (metres) |
| **Avoidance strength** | How strongly agents push each other apart |
| **Queue behaviour** | Toggle queuing at attractors on/off |
| **Evacuation** | When to trigger; panic-speed multiplier |
| **Warning / Danger thresholds** | Density limits (pers/m²) |
| **Heatmap cell size** | Spatial resolution of the density grid |

---

## How the Model Works

### Agent-Based Simulation

Each agent is a circle with position, velocity, and radius (~0.25 m). Agents follow a simple state machine:

```
spawn → seeking_attractor → queuing → at_attractor → seeking_exit → exited
                                       ↑ evacuation triggers transition
```

### Movement (Social Force Model)

At each timestep the net force on agent *i* is:

```
f = (v_desired − v_current) / τ   ← acceleration toward waypoint
  + Σ A·exp((ri+rj−dij)/B) · n̂   ← repulsion from nearby agents
  + Σ A_wall·exp((ri−d_wall)/B_wall) · n̂_wall  ← repulsion from walls
```

Constants: τ = 0.5 s, A = 2 m/s², B = 0.15 m (agent); A_wall = 3, B_wall = 0.1 m (walls).

### Path Planning (A*)

A coarse 1 m grid is built from the wall layout. When an agent is assigned a target, A* finds the shortest passable path. The agent then follows the resulting waypoints using local steering. Paths are recomputed if the agent gets stuck (velocity < 0.05 m/s for 2.5 s).

### Density Heatmap

The venue is divided into cells of configurable size (default 1 m²). Each tick the density in each cell is computed as agent count / cell area (pers/m²). The heatmap is rendered with a green → orange → red colour scale.

### Bottleneck Detection

Cells at or above the *danger* threshold are highlighted with a red border on the canvas.

### Performance

A **uniform spatial hash** (cell size = 2 × personal space) reduces the neighbour search from O(N²) to approximately O(N). At 2 000 agents the engine runs at 60 fps on a modern laptop.

### Safety Estimator

The estimator runs abbreviated simulations (larger timestep, shorter duration) for N ∈ [sweepMinN, sweepMaxN] in steps of *sweepStep*. It finds the highest N where **all three** criteria are met:

1. Peak density ≤ danger threshold
2. P95 egress time ≤ limit (default 8 min)
3. % sim-time above warning ≤ limit (default 5%)

---

## Project Structure

```
src/
├── models/
│   └── types.ts          — all TypeScript interfaces and enums
├── sim/
│   └── engine.ts         — SimEngine class + runSweep()
├── ui/
│   ├── VenueEditor.tsx   — canvas-based venue designer
│   ├── SimCanvas.tsx     — simulation renderer (heatmap, agents)
│   ├── SimControls.tsx   — all parameter sliders/inputs
│   ├── MetricsPanel.tsx  — live KPI display
│   └── SafetyEstimator.tsx — automated N sweep + chart
└── utils/
    ├── math.ts           — Vec2 helpers, Gaussian, closest-point
    ├── spatialHash.ts    — uniform grid spatial index
    ├── astar.ts          — grid A* + passable-grid builder
    └── export.ts         — JSON / CSV download helpers
```

---

## Known Limitations & How to Extend

| Limitation | How to fix |
|-----------|-----------|
| **A* is recomputed per-agent** | Cache paths keyed on (start-cell, goal-cell); use a navigation mesh |
| **Single-threaded** | Move engine.tick() into a Web Worker with a shared-memory buffer |
| **No fire/smoke spread** | Add a diffusion layer that marks cells impassable over time |
| **Simple queue model** | Implement multi-server queuing (M/G/c) at each attractor |
| **Social force constants are fixed** | Expose τ, A, B as sliders; or fit them to empirical pedestrian data |
| **No vertical flow** | Add stairs/escalators modelled as speed-reduction zones |
| **Sweep blocks the UI** | Offload runSweep() to a Web Worker or use async chunking |
| **agentById is O(N)** | Replace `agents.find()` with a `Map<id, Agent>` for O(1) lookup |
