from __future__ import annotations

import asyncio
import random

from mesa import Model
from mesa.space import MultiGrid

from simulation.agent import HumanLLMAgent


class EvaluationModel(Model):
    """Spatial simulation environment where every participant is an LLM agent.

    Agents are placed on a 2D grid. Each step they observe nearby agents
    (bounded by vision_radius), then decide to move.
    When an agent reaches any door position it is removed from the simulation.
    The simulation ends when all agents have exited or deadline is reached.
    """

    def __init__(
        self,
        width: int,
        height: int,
        deadline: int,
        door_positions: list[tuple[int, int]],
        agent_configs: list[dict],
        llm_model: str,
        obstacles: list[list[int]] | None = None,
        num_initial_fires: int = 0,
        fire_spread_probability: float = 0.15,
        fire_seed: int | None = None,
    ):
        super().__init__()
        self.grid = MultiGrid(width, height, torus=False)
        self.deadline = deadline
        self.door_positions: set[tuple[int, int]] = {tuple(d) for d in door_positions}
        self.obstacles: set[tuple[int, int]] = {tuple(o) for o in obstacles} if obstacles else set()
        self.num_initial_fires = max(0, int(num_initial_fires))
        self.fire_spread_probability = max(0.0, min(1.0, float(fire_spread_probability)))
        self._fire_rng = random.Random(fire_seed)
        self.fire_cells: set[tuple[int, int]] = set()
        self.current_step = 0
        self.position_history: list[dict] = []  # [{name: (x,y) | "exited"}, ...]
        self.status_history: list[dict] = []  # [{name: "active"|"exited"|"dead"}, ...]
        self.fire_history: list[list[list[int]]] = []  # [[[x,y], ...], ...]
        self._all_agent_names: list[str] = []
        self._dead_agent_names: set[str] = set()
        self._exited_agent_names: set[str] = set()

        initial_positions: set[tuple[int, int]] = set()
        for cfg in agent_configs:
            position = tuple(cfg["position"])
            initial_positions.add(position)
            agent = HumanLLMAgent(
                model=self,
                name=cfg["name"],
                role=cfg.get("role"),
                personality=cfg.get("personality"),
                llm_model=llm_model,
                door_positions=self.door_positions,
                obstacles=self.obstacles,
            )
            self.grid.place_agent(agent, position)
            self._all_agent_names.append(cfg["name"])

        self._seed_initial_fires(forbidden=initial_positions | self.obstacles | self.door_positions)

    def _seed_initial_fires(self, forbidden: set[tuple[int, int]]):
        if self.num_initial_fires <= 0:
            return
        candidates = [
            (x, y)
            for x in range(self.grid.width)
            for y in range(self.grid.height)
            if (x, y) not in forbidden
        ]
        if not candidates:
            return
        self._fire_rng.shuffle(candidates)
        chosen = candidates[: min(self.num_initial_fires, len(candidates))]
        self.fire_cells.update(chosen)

    def _spread_fires(self):
        if not self.fire_cells or self.fire_spread_probability <= 0:
            return

        to_ignite: set[tuple[int, int]] = set()
        for fx, fy in self.fire_cells:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nx, ny = fx + dx, fy + dy
                    if nx < 0 or ny < 0 or nx >= self.grid.width or ny >= self.grid.height:
                        continue
                    new_cell = (nx, ny)
                    if (
                        new_cell in self.fire_cells
                        or new_cell in self.obstacles
                        or new_cell in self.door_positions
                    ):
                        continue
                    if self._fire_rng.random() < self.fire_spread_probability:
                        to_ignite.add(new_cell)

        if to_ignite:
            self.fire_cells.update(to_ignite)

    def _check_fire_deaths(self):
        if not self.fire_cells:
            return
        for agent in list(self.agents):
            if agent.pos in self.fire_cells:
                death_pos = agent.pos
                self._dead_agent_names.add(agent.name)
                self.grid.remove_agent(agent)
                agent.remove()
                print(f"  !! {agent.name} died in fire at {death_pos}")

    def _check_door_exits(self):
        for agent in list(self.agents):
            if agent.pos in self.door_positions:
                agent.exited = True
                self._exited_agent_names.add(agent.name)
                self.grid.remove_agent(agent)
                agent.remove()
                print(f"  >> {agent.name} has exited through the door!")

    def step(self):
        if self.current_step >= self.deadline or not list(self.agents):
            self.running = False
            return

        print(f"\n=== Step {self.current_step + 1} / {self.deadline} ===")

        async def _run_parallel():
            await asyncio.gather(*[a.astep() for a in self.agents])

        asyncio.run(_run_parallel())
        self._check_fire_deaths()
        self._check_door_exits()
        self._spread_fires()
        self._check_fire_deaths()
        self.current_step += 1
        self._record_frame()

        if not list(self.agents):
            print("\nAll agents have exited or died!")
            self.running = False

    def _record_frame(self):
        active_agents = {a.name: a for a in self.agents}
        pos_frame: dict[str, tuple | str] = {}
        status_frame: dict[str, str] = {}

        for name in self._all_agent_names:
            if name in active_agents:
                pos_frame[name] = active_agents[name].pos
                status_frame[name] = "active"
            elif name in self._dead_agent_names:
                pos_frame[name] = "exited"
                status_frame[name] = "dead"
            else:
                pos_frame[name] = "exited"
                status_frame[name] = "exited"

        self.position_history.append(pos_frame)
        self.status_history.append(status_frame)
        self.fire_history.append([list(cell) for cell in sorted(self.fire_cells)])
