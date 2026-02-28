from __future__ import annotations

from typing import TYPE_CHECKING

import mesa_llm.tools.inbuilt_tools  # registers inbuilt tools first  # noqa: F401
from mesa_llm.tools.tool_decorator import tool

if TYPE_CHECKING:
    from mesa_llm.llm_agent import LLMAgent

_DIRECTION_DELTAS: dict[str, tuple[int, int]] = {
    "North": (0, 1),
    "South": (0, -1),
    "East": (1, 0),
    "West": (-1, 0),
    "NorthEast": (1, 1),
    "NorthWest": (-1, 1),
    "SouthEast": (1, -1),
    "SouthWest": (-1, -1),
}


@tool
def move_one_step(direction: str, agent: "LLMAgent") -> str:
    """Move the agent one cell in a cardinal or diagonal direction.
    Blocked if the target cell is already occupied by another agent.

    Args:
        direction: One of North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest.
        agent: Provided automatically.

    Returns:
        A string describing the result of the move attempt.
    """
    if direction not in _DIRECTION_DELTAS:
        raise ValueError(
            f"Invalid direction '{direction}'. Must be one of: {list(_DIRECTION_DELTAS)}"
        )

    dx, dy = _DIRECTION_DELTAS[direction]
    x, y = agent.pos
    new_x = max(0, min(x + dx, agent.model.grid.width - 1))
    new_y = max(0, min(y + dy, agent.model.grid.height - 1))
    new_pos = (new_x, new_y)

    if new_pos in agent.model.obstacles:
        return f"Blocked — {new_pos} is a wall. Choose a different direction."

    occupants = agent.model.grid.get_cell_list_contents([new_pos])
    if occupants:
        names = [getattr(o, "name", str(o.unique_id)) for o in occupants]
        return f"Blocked — {new_pos} is occupied by {names}. Choose a different direction."

    agent.model.grid.move_agent(agent, new_pos)
    return f"Moved {direction} to {new_pos}."
