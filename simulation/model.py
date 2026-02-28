from __future__ import annotations

import asyncio

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
    ):
        super().__init__()
        self.grid = MultiGrid(width, height, torus=False)
        self.deadline = deadline
        self.door_positions: set[tuple[int, int]] = {tuple(d) for d in door_positions}
        self.obstacles: set[tuple[int, int]] = {tuple(o) for o in obstacles} if obstacles else set()
        self.current_step = 0
        self.position_history: list[dict] = []  # [{name: (x,y) | "exited"}, ...]
        self._all_agent_names: list[str] = []

        for cfg in agent_configs:
            position = tuple(cfg["position"])
            agent = HumanLLMAgent(
                model=self,
                name=cfg["name"],
                role=cfg["role"],
                personality=cfg["personality"],
                llm_model=llm_model,
                door_positions=self.door_positions,
                obstacles=self.obstacles,
            )
            self.grid.place_agent(agent, position)
            self._all_agent_names.append(cfg["name"])

    def _check_door_exits(self):
        for agent in list(self.agents):
            if agent.pos in self.door_positions:
                agent.exited = True
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
        self._check_door_exits()
        self.current_step += 1

        # Record positions for this step
        active_agents = {a.name: a for a in self.agents}
        pos_frame: dict[str, tuple | str] = {}
        for name in self._all_agent_names:
            if name in active_agents:
                pos_frame[name] = active_agents[name].pos
            else:
                pos_frame[name] = "exited"
        self.position_history.append(pos_frame)

        if not list(self.agents):
            print("\nAll agents have exited!")
            self.running = False
