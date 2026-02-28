from __future__ import annotations

import json
import random
import yaml
from dotenv import load_dotenv

from simulation.model import EvaluationModel

load_dotenv()

TRAJECTORY_FILE = "trajectory.json"


def _generate_random_agent_configs(env: dict, door_positions: list[tuple[int, int]], obstacles: list[tuple[int, int]]) -> list[dict]:
    width = env["width"]
    height = env["height"]
    num_agents = int(env.get("num_agents", 0))
    if num_agents <= 0:
        raise ValueError("Set environment.num_agents > 0 when agents list is not provided.")

    rng = random.Random(env.get("random_seed"))
    blocked = set(door_positions) | set(obstacles)
    valid_positions = [
        (x, y)
        for x in range(width)
        for y in range(height)
        if (x, y) not in blocked
    ]

    if num_agents > len(valid_positions):
        raise ValueError(
            f"Cannot place {num_agents} agents on {width}x{height} grid "
            f"with {len(blocked)} blocked cells; max is {len(valid_positions)}."
        )

    rng.shuffle(valid_positions)
    name_prefix = env.get("agent_name_prefix", "Agent")

    agents: list[dict] = []
    for i in range(num_agents):
        x, y = valid_positions[i]
        agents.append(
            {
                "name": f"{name_prefix} {i + 1}",
                "position": [x, y],
            }
        )
    return agents


def main():
    with open("configs/agents.yaml") as f:
        cfg = yaml.safe_load(f)

    env = cfg["environment"]
    door_positions = [tuple(d) for d in env["doors"]]
    obstacles = [tuple(o) for o in env.get("obstacles", [])]

    agent_configs = cfg.get("agents")
    if not agent_configs:
        agent_configs = _generate_random_agent_configs(
            env=env,
            door_positions=door_positions,
            obstacles=obstacles,
        )
        print(f"Generated {len(agent_configs)} random agents from environment.num_agents.")

    model = EvaluationModel(
        width=env["width"],
        height=env["height"],
        deadline=env["deadline"],
        door_positions=door_positions,
        agent_configs=agent_configs,
        llm_model=env["llm_model"],
        obstacles=obstacles,
    )

    while model.running:
        model.step()

    print("\n=== Simulation complete ===")
    print(f"Ran for {model.current_step} steps.\n")

    for name in model._all_agent_names:
        agent = next((a for a in model.agents if a.name == name), None)
        if agent:
            print(f"--- {name} @ {agent.pos} ---")
            if agent.memory is not None:
                print(agent.memory.get_prompt_ready())
        else:
            print(f"--- {name} --- EXITED")
        print()

    trajectory = {
        "width": env["width"],
        "height": env["height"],
        "door_positions": [list(d) for d in door_positions],
        "obstacles": [list(o) for o in obstacles],
        "history": model.position_history,
    }
    with open(TRAJECTORY_FILE, "w") as f:
        json.dump(trajectory, f)
    print(f"Trajectory saved to {TRAJECTORY_FILE}")
    print(f"Visualize with: python -m simulation.visualize")


if __name__ == "__main__":
    main()
