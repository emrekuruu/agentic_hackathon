from __future__ import annotations

from mesa_llm.llm_agent import LLMAgent
from mesa_llm.reasoning.cot import CoTReasoning

import simulation.tools  # registers @tool decorated functions  # noqa: F401


class HumanLLMAgent(LLMAgent):
    """An LLM-powered agent that simulates a human participant.

    Each agent has a unique personality and role encoded in its system prompt.
    Each step the agent observes nearby agents, reasons via CoT, and executes
    move / speak tool calls. When it reaches the door it exits the simulation.
    """

    def __init__(
        self,
        model,
        name: str,
        role: str,
        personality: str,
        llm_model: str,
        door_position: tuple[int, int],
        obstacles: set[tuple[int, int]],
    ):
        w = model.grid.width
        h = model.grid.height
        vision_radius = w + h  # see the entire grid

        obstacles_str = ", ".join(str(o) for o in sorted(obstacles)) if obstacles else "none"

        system_prompt = (
            f"You are {name}, a human participant in a group simulation.\n"
            f"Your role: {role}.\n"
            f"Your personality: {personality}.\n\n"
            f"The grid is {w} × {h}. Valid positions: x from 0 to {w - 1}, y from 0 to {h - 1}. "
            "You cannot move outside these bounds.\n"
            f"The exit door is at {door_position}. "
            f"Impassable walls are at: {obstacles_str}.\n\n"
            "Each turn you receive an observation of your position and all other participants. "
            "You MUST choose EXACTLY ONE action per turn — either move OR speak, never both:\n"
            "- move_one_step(direction): move in one of 8 directions "
            "(North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest)\n"
            "- speak_nearby(message): say something to everyone within range\n\n"
            "Call exactly one tool. Do not call both in the same turn."
        )

        step_prompt = (
            f"Grid: {w}×{h} (x: 0–{w - 1}, y: 0–{h - 1}). "
            f"Exit door: {door_position}. "
            f"Walls: {obstacles_str}. "
            "Your goal is to reach the door and leave the room. "
            "Choose EXACTLY ONE action: move one step toward the door, or speak to nearby participants. Not both."
        )

        super().__init__(
            model=model,
            reasoning=CoTReasoning,
            llm_model=llm_model,
            system_prompt=system_prompt,
            vision=vision_radius,
            step_prompt=step_prompt,
        )

        self.name = name
        self.role = role
        self.personality = personality
        self.vision_radius = vision_radius
        self.door_position = door_position
        self.obstacles = obstacles
        self.exited = False
        self.last_speech: str | None = None

    def step(self):
        self.last_speech = None
        obs = self.generate_obs()
        plan = self.reasoning.plan(obs=obs)
        self.apply_plan(plan)

    async def astep(self):
        self.last_speech = None
        obs = await self.agenerate_obs()
        plan = await self.reasoning.aplan(prompt=self.step_prompt, obs=obs)
        await self.aapply_plan(plan)
