from __future__ import annotations

import yaml
from dotenv import load_dotenv

from simulation.model import EvaluationModel
from simulation.visualization import animate

load_dotenv()


def main():
    with open("configs/agents.yaml") as f:
        cfg = yaml.safe_load(f)

    env = cfg["environment"]
    door_position = tuple(env["door"])
    obstacles = [tuple(o) for o in env.get("obstacles", [])]

    model = EvaluationModel(
        width=env["width"],
        height=env["height"],
        deadline=env["deadline"],
        door_position=door_position,
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

    animate(
        history=model.position_history,
        width=env["width"],
        height=env["height"],
        door_position=door_position,
        speech_history=model.speech_history,
        obstacles=obstacles,
    )


if __name__ == "__main__":
    main()
