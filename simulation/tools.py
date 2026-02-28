from __future__ import annotations

from typing import TYPE_CHECKING

import mesa_llm.tools.inbuilt_tools  # registers move_one_step, teleport_to_location, speak_to  # noqa: F401
from mesa_llm.tools.tool_decorator import tool

if TYPE_CHECKING:
    from mesa_llm.llm_agent import LLMAgent


@tool
def speak_nearby(message: str, agent: "LLMAgent") -> str:
    """Broadcast a message to all agents within this agent's vision radius.

    Args:
        message: The message content to say aloud to nearby agents.
        agent: Provided automatically.

    Returns:
        A string confirming who received the message.
    """
    neighbors = agent.model.grid.get_neighbors(
        agent.pos,
        moore=True,
        include_center=False,
        radius=agent.vision_radius,
    )

    recipients = [n for n in neighbors if n is not agent]

    if not recipients:
        return "Spoke, but no one was nearby to hear."

    for recipient in recipients:
        recipient.memory.add_to_memory(
            type="message",
            content={
                "message": message,
                "sender": agent.unique_id,
                "recipients": [r.unique_id for r in recipients],
            },
        )

    names = [getattr(r, "name", str(r.unique_id)) for r in recipients]
    return f"Said to {names}: '{message}'"
