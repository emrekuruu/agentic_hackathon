# Agentic Hackathon — LLM Agent Evaluation Simulation

A spatial simulation where every "human" participant is an LLM agent. Agents have distinct personalities, roles, and memories. They navigate a 2D grid, speak to nearby participants, and try to exit through a door. Built on [Mesa](https://mesa.readthedocs.io/) + [Mesa-LLM](https://github.com/projectmesa/mesa-llm).

---

## Quick Start

```bash
# 1. Install dependencies
poetry install

# 2. Add your API key
echo "OPENAI_API_KEY=sk-..." > .env

# 3. Run
python -m simulation.run
```

---

## Project Structure

```
agentic_hackathon/
├── configs/
│   └── agents.yaml          # ALL simulation configuration lives here
├── simulation/
│   ├── model.py             # Environment physics and rules
│   ├── agent.py             # LLM agent inputs, prompts, and decision loop
│   ├── tools.py             # Actions agents can take (speak)
│   ├── visualization.py     # Matplotlib animation playback
│   └── run.py               # Entry point
└── .env                     # API keys (never commit this)
```

---

## File-by-File Breakdown

---

### `configs/agents.yaml` — The Control Panel

**This is the only file you need to edit for most experiments.**

```yaml
environment:
  width: 10          # grid width  (x: 0 to width-1)
  height: 10         # grid height (y: 0 to height-1)
  deadline: 10       # max steps before simulation force-stops
  llm_model: "openai/gpt-4o-mini"   # any litellm-compatible model string
  door: [9, 5]       # (x, y) position of the exit door

agents:
  - name: "Alice"
    role: "domain expert"
    personality: "Analytical, skeptical, and data-driven."
    position: [2, 3]     # starting (x, y) on the grid
    vision_radius: 2     # how many cells away the agent can see
```

**What each field controls:**
| Field | Effect |
|---|---|
| `width` / `height` | Grid size. Agents cannot move outside these bounds. |
| `deadline` | Hard cutoff. Simulation stops after this many steps even if agents haven't exited. |
| `llm_model` | The LLM powering all agents. Uses [litellm](https://docs.litellm.ai/) format: `provider/model`. |
| `door` | The single exit tile. Agents are removed when they land on it. |
| `name` | Agent's name, shown in the visualization and injected into their system prompt. |
| `role` | Injected into system prompt. Shapes how the agent frames decisions. |
| `personality` | Injected into system prompt. Defines communication style and priorities. |
| `position` | Starting cell on the grid. |
| `vision_radius` | Observation radius. An agent only sees other agents within this many cells (Moore neighborhood). |

---

### `simulation/model.py` — Environment Physics

**`EvaluationModel`** is the "world." It owns the grid, enforces the physics, and orchestrates time.

**What it controls:**
- **The grid** — a `MultiGrid` (multiple agents can share a cell). Grid coordinates are `(x, y)`, origin bottom-left.
- **The step loop** — each call to `model.step()` advances time by one tick. All agents act in a random shuffled order each tick.
- **The door rule** — after all agents have acted, `_check_door_exits()` scans for any agent standing on `door_position`. Those agents are removed from the grid and deregistered from the model entirely.
- **Termination** — the simulation stops when either (a) the deadline is reached or (b) no agents remain on the grid.
- **Position history** — after every step, records each agent's position (or `"exited"`) for the visualization replay.

**To change physics**, edit this file:
- Change the movement rules → override what happens in `_check_door_exits` or add new exit conditions.
- Add obstacles → check agent positions against a set of blocked cells inside `step()`.
- Add multiple doors → change `door_position` to a list and update `_check_door_exits`.
- Add time pressure → shorten `deadline` or add a shrinking safe zone.

---

### `simulation/agent.py` — LLM Agent Inputs & Decision Loop

**`HumanLLMAgent`** is what each simulated human actually is. It wires together three inputs that the LLM sees every turn, and defines what happens at each step.

#### The three inputs to the LLM each turn:

**1. `system_prompt` — who the agent is (set once at startup)**
```
You are {name}, a human participant in a group simulation.
Your role: {role}.
Your personality: {personality}.

Available tools:
- move_one_step(direction): move in one of 8 directions
- speak_nearby(message): say something to nearby agents
```
This is the agent's identity. It never changes during the simulation.

**2. `step_prompt` — what the agent is trying to do (set once at startup)**
```
The exit door is at position (9, 5).
Your goal is to reach the door and leave the room.
Move toward the door each turn.
You may also speak to nearby participants as you move.
```
This is the agent's objective. Change this to change the simulation goal entirely — e.g., "Find the agent named Bob and deliver a message" or "Stay as far from other agents as possible."

**3. Observation — what the agent currently sees (generated fresh each step)**

Built automatically by `generate_obs()`, which collects:
- The agent's own current position
- All other agents within `vision_radius` cells, with their positions

This is injected into the CoT reasoning prompt alongside the agent's memory.

#### The step loop (runs every tick):
```python
def step(self):
    obs = self.generate_obs()          # build spatial observation
    plan = self.reasoning.plan(obs=obs) # CoT: think → decide → pick tools
    self.apply_plan(plan)              # execute the chosen tool calls
```

The **CoT (Chain-of-Thought) reasoning** makes the LLM:
1. Write explicit `Thought 1…4` reasoning steps
2. State an `Action`
3. Then call tools to actually execute it

**Memory** (`STLTMemory`) stores past observations, plans, and messages. Short-term holds the last 5 steps; long-term is a compressed LLM summary. Both feed into the next step's reasoning.

**To change agent behavior**, edit this file:
- Change the goal → edit `step_prompt`.
- Change the persona → edit how `system_prompt` is built from `role` and `personality`.
- Change the reasoning style → swap `CoTReasoning` for `ReActReasoning` or `ReWOOReasoning`.
- Add more context → extend `internal_state` with custom fields visible to the LLM.

---

### `simulation/tools.py` — Actions Agents Can Take

Tools are the only way agents affect the world. Each tool is a Python function decorated with `@tool`. Mesa-LLM auto-generates the OpenAI function-calling schema from the docstring and type hints, then injects the `agent` argument automatically at call time.

**Currently registered tools:**

| Tool | Defined in | What it does |
|---|---|---|
| `move_one_step(direction)` | `mesa_llm.tools.inbuilt_tools` | Moves agent one cell in a cardinal/diagonal direction. Bounded by grid edges. |
| `speak_nearby(message)` | `simulation/tools.py` | Broadcasts a message to all agents within `vision_radius`. Messages are written directly into recipients' memory. |
| `teleport_to_location(target_coordinates)` | `mesa_llm.tools.inbuilt_tools` | Teleports agent to any `[x, y]` cell. (Available to LLM but not advertised in system prompt.) |

**To add a new action** (e.g., `pick_up_item`, `wait`, `signal`):
1. Write a function in `tools.py` with a full Google-style `Args:` docstring
2. Decorate it with `@tool`
3. Mention it in the agent's `system_prompt` so the LLM knows it exists

---

### `simulation/visualization.py` — Animation Playback

Runs **after** the simulation completes. Reads `model.position_history` (a list of per-step snapshots) and renders a `FuncAnimation` that loops through the steps.

- Each agent is a colored circle with their initial letter
- The exit door is a yellow "EXIT" tile (static)
- Exited agents disappear from the grid
- The title shows current step and agents remaining

**To customize visuals**, edit `_COLORS`, the `FancyBboxPatch` for the door, or `interval_ms` for playback speed.

---

### `simulation/run.py` — Entry Point

Reads `configs/agents.yaml`, instantiates `EvaluationModel`, runs the simulation loop, prints each agent's final memory transcript, then opens the visualization window.

Nothing simulation-logic lives here — it's purely orchestration.

---

## How a Single Step Works End-to-End

```
model.step()
  └── for each agent (random order):
        agent.step()
          ├── generate_obs()          → spatial snapshot of nearby agents
          ├── reasoning.plan(obs)     → CoT LLM call → picks tool calls
          └── apply_plan(plan)        → executes move_one_step / speak_nearby
  └── _check_door_exits()             → remove agents on door tile
  └── record position_history[step]
```

---

## Extending the Simulation

| Want to... | Edit |
|---|---|
| Change grid size or deadline | `configs/agents.yaml` → `environment` |
| Add / remove agents | `configs/agents.yaml` → `agents` list |
| Change what agents are trying to do | `simulation/agent.py` → `step_prompt` |
| Change agent identity / persona | `configs/agents.yaml` → `role`, `personality` |
| Add a new action (tool) | `simulation/tools.py` |
| Add obstacles or new physics | `simulation/model.py` → `step()` |
| Change the LLM model | `configs/agents.yaml` → `llm_model` |
| Change reasoning strategy | `simulation/agent.py` → swap `CoTReasoning` |
| Customize the animation | `simulation/visualization.py` |
