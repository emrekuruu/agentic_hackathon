from __future__ import annotations

import json
import random
import yaml
from dotenv import load_dotenv

from simulation.model import EvaluationModel

load_dotenv()

TRAJECTORY_FILE = "trajectory.json"


def _in_main_area(x: int, y: int, width: int, height: int) -> bool:
    x_min, x_max = width * 0.15, width * 0.85
    y_min, y_max = height * 0.35, height * 0.65
    return x_min <= x <= x_max and y_min <= y <= y_max


def _build_obstacle_spawn_candidates(
    width: int,
    height: int,
    blocked: set[tuple[int, int]],
    source_obstacles: list[tuple[int, int]],
    rng: random.Random,
    limit: int,
) -> list[tuple[int, int]]:
    """Return free cells ordered from closest to obstacle cells outward."""
    if not source_obstacles or limit <= 0:
        return []

    picked: set[tuple[int, int]] = set()
    ordered: list[tuple[int, int]] = []
    max_radius = max(width, height)

    for radius in range(1, max_radius + 1):
        ring: list[tuple[int, int]] = []
        for ox, oy in source_obstacles:
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    if max(abs(dx), abs(dy)) != radius:
                        continue
                    nx, ny = ox + dx, oy + dy
                    pos = (nx, ny)
                    if (
                        nx < 0
                        or ny < 0
                        or nx >= width
                        or ny >= height
                        or pos in blocked
                        or pos in picked
                    ):
                        continue
                    ring.append(pos)
        if ring:
            rng.shuffle(ring)
            for pos in ring:
                if pos in picked:
                    continue
                picked.add(pos)
                ordered.append(pos)
                if len(ordered) >= limit:
                    return ordered

    return ordered


def _generate_random_agent_configs(env: dict, door_positions: list[tuple[int, int]], obstacles: list[tuple[int, int]]) -> list[dict]:
    width = env["width"]
    height = env["height"]
    num_agents = int(env.get("num_agents", 0))
    if num_agents <= 0:
        raise ValueError("Set environment.num_agents > 0 when agents list is not provided.")

    rng = random.Random(env.get("random_seed"))
    blocked = set(door_positions) | set(obstacles)
    free_positions = [
        (x, y)
        for x in range(width)
        for y in range(height)
        if (x, y) not in blocked
    ]

    if num_agents > len(free_positions):
        raise ValueError(
            f"Cannot place {num_agents} agents on {width}x{height} grid "
            f"with {len(blocked)} blocked cells; max is {len(free_positions)}."
        )

    main_obstacles = [o for o in obstacles if _in_main_area(o[0], o[1], width, height)]
    obstacle_source = main_obstacles or obstacles
    candidate_positions = _build_obstacle_spawn_candidates(
        width=width,
        height=height,
        blocked=blocked,
        source_obstacles=obstacle_source,
        rng=rng,
        limit=num_agents,
    )

    if len(candidate_positions) < num_agents:
        remainder = [pos for pos in free_positions if pos not in set(candidate_positions)]
        rng.shuffle(remainder)
        candidate_positions.extend(remainder[: num_agents - len(candidate_positions)])

    name_prefix = env.get("agent_name_prefix", "Agent")

    agents: list[dict] = []
    for i in range(num_agents):
        x, y = candidate_positions[i]
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
    fire_cfg = env.get("fire", {})
    num_initial_fires = int(fire_cfg.get("num_initial_fires", fire_cfg.get("num_fires", 0)))
    fire_spread_probability = float(fire_cfg.get("spread_probability", 0.15))
    fire_seed = fire_cfg.get("random_seed", env.get("random_seed"))

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
        num_initial_fires=num_initial_fires,
        fire_spread_probability=fire_spread_probability,
        fire_seed=fire_seed,
    )

    while model.running:
        model.step()

    print("\n=== Simulation complete ===")
    print(f"Ran for {model.current_step} steps.\n")

    final_status = model.status_history[-1] if model.status_history else {}
    for name in model._all_agent_names:
        agent = next((a for a in model.agents if a.name == name), None)
        status = final_status.get(name, "active" if agent else "exited")
        if status == "dead":
            print(f"--- {name} --- DEAD")
        elif agent:
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
        "status_history": model.status_history,
        "fire_history": model.fire_history,
    }
    with open(TRAJECTORY_FILE, "w") as f:
        json.dump(trajectory, f)
    print(f"Trajectory saved to {TRAJECTORY_FILE}")
    print(f"Visualize with: python -m simulation.visualize")


if __name__ == "__main__":
    main()
