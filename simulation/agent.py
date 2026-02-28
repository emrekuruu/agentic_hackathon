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
        vision_radius: int,
        door_position: tuple[int, int],
    ):
        system_prompt = (
            f"You are {name}, a human participant in a group simulation.\n"
            f"Your role: {role}.\n"
            f"Your personality: {personality}.\n\n"
            "Each turn you receive an observation of your position and nearby participants. "
            "You must choose actions from the available tools:\n"
            "- move_one_step(direction): move in one of 8 directions "
            "(North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest)\n"
            "- speak_nearby(message): say something to everyone within your vision range\n\n"
            "Act naturally according to your personality and role. "
            "You may move, speak, or do both each turn."
        )

        step_prompt = (
            f"The exit door is at position {door_position}. "
            "Your goal is to reach the door and leave the room. "
            "Move toward the door each turn. "
            "You may also speak to nearby participants as you move."
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
        self.exited = False

    def step(self):
        obs = self.generate_obs()
        plan = self.reasoning.plan(obs=obs)
        self.apply_plan(plan)
