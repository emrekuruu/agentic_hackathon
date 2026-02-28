from __future__ import annotations

from mesa import Model
from mesa.space import MultiGrid

from simulation.agent import HumanLLMAgent


class EvaluationModel(Model):
    """Spatial simulation environment where every participant is an LLM agent.

    Agents are placed on a 2D grid. Each step they observe nearby agents
    (bounded by vision_radius), then decide to move and/or speak.
    When an agent reaches door_position it is removed from the simulation.
    The simulation ends when all agents have exited or deadline is reached.
    """

    def __init__(
        self,
        width: int,
        height: int,
        deadline: int,
        door_position: tuple[int, int],
        agent_configs: list[dict],
        llm_model: str,
    ):
        super().__init__()
        self.grid = MultiGrid(width, height, torus=False)
        self.deadline = deadline
        self.door_position = tuple(door_position)
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
                vision_radius=cfg["vision_radius"],
                door_position=self.door_position,
            )
            self.grid.place_agent(agent, position)
            self._all_agent_names.append(cfg["name"])

    def _check_door_exits(self):
        for agent in list(self.agents):
            if agent.pos == self.door_position:
                agent.exited = True
                self.grid.remove_agent(agent)
                agent.remove()
                print(f"  >> {agent.name} has exited through the door!")

    def step(self):
        if self.current_step >= self.deadline or not list(self.agents):
            self.running = False
            return

        print(f"\n=== Step {self.current_step + 1} / {self.deadline} ===")
        self.agents.shuffle_do("step")
        self._check_door_exits()
        self.current_step += 1

        # Record positions; exited agents get "exited" sentinel
        active_positions = {a.name: a.pos for a in self.agents}
        frame: dict[str, tuple | str] = {}
        for name in self._all_agent_names:
            frame[name] = active_positions.get(name, "exited")
        self.position_history.append(frame)

        if not list(self.agents):
            print("\nAll agents have exited!")
            self.running = False
