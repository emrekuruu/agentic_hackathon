from __future__ import annotations

import json
import sys

from simulation.visualization import animate

TRAJECTORY_FILE = "trajectory.json"


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else TRAJECTORY_FILE
    with open(path) as f:
        data = json.load(f)

    animate(
        history=data["history"],
        width=data["width"],
        height=data["height"],
        door_positions=[tuple(d) for d in data["door_positions"]],
        obstacles=[tuple(o) for o in data.get("obstacles", [])],
    )


if __name__ == "__main__":
    main()
