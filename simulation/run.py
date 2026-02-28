from __future__ import annotations

import json
import yaml
from dotenv import load_dotenv

from simulation.model import EvaluationModel

load_dotenv()

TRAJECTORY_FILE = "trajectory.json"


def main():
    with open("configs/agents.yaml") as f:
        cfg = yaml.safe_load(f)

    env = cfg["environment"]
    door_positions = [tuple(d) for d in env["doors"]]
    obstacles = [tuple(o) for o in env.get("obstacles", [])]

    model = EvaluationModel(
        width=env["width"],
        height=env["height"],
        deadline=env["deadline"],
        door_positions=door_positions,
        agent_configs=cfg["agents"],
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
            print(f"--- {name} ({agent.role}) @ {agent.pos} ---")
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
