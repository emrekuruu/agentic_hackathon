"""Orchestration script: run simulation, compute benchmarks, save JSON.

Usage:
    python -m benchmarks.runner
    python -m benchmarks.runner --config configs/agents.yaml --output results/run_results.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml
from dotenv import load_dotenv

from benchmarks.results import build_results, save_results
from simulation.model import EvaluationModel

load_dotenv()


def load_profiles(path: str = "profiles.json") -> list[dict] | None:
    """Load agent profiles for vulnerability analysis. Returns None if missing."""
    p = Path(path)
    if not p.exists():
        return None
    with open(p) as f:
        data = json.load(f)
    return data.get("profiles", data) if isinstance(data, dict) else data


def run_benchmark(
    config_path: str = "configs/agents.yaml",
    output_path: str = "results/run_results.json",
) -> dict:
    """Run the full simulation and produce benchmark results."""

    # 1. Load config
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    env = cfg["environment"]
    door_position = tuple(env["door"])
    grid_size = (env["width"], env["height"])
    deadline = env["deadline"]

    # 2. Capture agent start positions
    agent_start_positions: dict[str, tuple[int, int]] = {
        a["name"]: tuple(a["position"]) for a in cfg["agents"]
    }

    # 3. Create and run EvaluationModel
    model = EvaluationModel(
        width=env["width"],
        height=env["height"],
        deadline=deadline,
        door_position=door_position,
        agent_configs=cfg["agents"],
        llm_model=env["llm_model"],
    )

    print("Running simulation...")
    while model.running:
        model.step()

    print(f"Simulation complete — {model.current_step} steps.\n")

    # 4. Extract position_history
    position_history = model.position_history

    # 5. Load profiles for vulnerability analysis
    profiles = load_profiles()

    # 6. Build results
    results = build_results(
        position_history=position_history,
        door_position=door_position,
        grid_size=grid_size,
        deadline=deadline,
        agent_start_positions=agent_start_positions,
        profiles=profiles,
    )

    # 7. Save results
    out_path = save_results(results, output_path)
    print(f"Results saved to {out_path}")

    # 8. Print summary
    overview = results["simulationOverview"]
    print("\n--- Benchmark Summary ---")
    print(f"  Agents: {overview['totalAgents']}")
    print(f"  Evacuated: {overview['totalEvacuated']}")
    print(f"  Deaths: {overview['totalDeaths']}")
    print(f"  Survival rate: {overview['survivalRate']:.1%}")
    if overview["meanEvacuationTime"] is not None:
        print(f"  Mean evacuation time: {overview['meanEvacuationTime']:.1f} steps")
    if overview["timeToFirstEvacuation"] is not None:
        print(f"  First evacuation at step: {overview['timeToFirstEvacuation']}")
    if overview["lastEvacuationTime"] is not None:
        print(f"  Last evacuation at step: {overview['lastEvacuationTime']}")

    scorecards = results["agentScorecards"]
    print("\n  Per-agent:")
    for name, sc in scorecards.items():
        status = f"evacuated at step {sc['evacuationTime']}" if sc["survived"] else "did not evacuate"
        print(f"    {name}: {status} (efficiency: {sc['optimalPathRatio']:.2f})")

    bottlenecks = results["groupDynamics"]["bottleneckEvents"]
    if bottlenecks:
        print(f"\n  Bottleneck events: {len(bottlenecks)}")
    print(f"  Peak door density: {results['spatialAnalysis']['peakBottleneckDensity']}")
    print(f"  Wasted exit capacity: {results['spatialAnalysis']['wastedExitCapacity']} steps")

    return results


def main():
    parser = argparse.ArgumentParser(description="Run evacuation simulation benchmarks")
    parser.add_argument(
        "--config", default="configs/agents.yaml", help="Path to agent config YAML"
    )
    parser.add_argument(
        "--output", default="results/run_results.json", help="Path for JSON output"
    )
    args = parser.parse_args()

    run_benchmark(config_path=args.config, output_path=args.output)


if __name__ == "__main__":
    main()
