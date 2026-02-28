"""Assemble all 32 metrics into a structured JSON-serialisable dict.

Computable metrics get real values; deferred metrics appear as null / 0 / [].
"""

from __future__ import annotations

import json
from pathlib import Path

from benchmarks import metrics


def build_results(
    position_history: list[dict],
    door_position: tuple[int, int],
    grid_size: tuple[int, int],
    deadline: int,
    agent_start_positions: dict[str, tuple[int, int]],
    profiles: list[dict] | None = None,
) -> dict:
    """Build the full benchmark results dict with 4 sections."""

    evac_times = metrics.compute_evacuation_times(position_history)
    total_agents = len(evac_times)
    total_evacuated = sum(1 for t in evac_times.values() if t is not None)
    exits = [door_position]

    # ------------------------------------------------------------------
    # 1. Simulation Overview
    # ------------------------------------------------------------------
    simulation_overview = {
        "survivalRate": metrics.compute_survival_rate(evac_times),
        "totalDeaths": total_agents - total_evacuated,
        "totalInjuries": 0,  # deferred — needs fire/smoke data
        "meanEvacuationTime": metrics.compute_mean_evacuation_time(evac_times),
        "lastEvacuationTime": metrics.compute_last_evacuation_time(evac_times),
        "timeToFirstEvacuation": metrics.compute_time_to_first_evacuation(evac_times),
        "timeTo50PercentEvacuation": metrics.compute_time_to_50_percent(evac_times),
        "totalAgents": total_agents,
        "totalEvacuated": total_evacuated,
        "deadline": deadline,
        "gridSize": list(grid_size),
        "doorPosition": list(door_position),
        "totalSteps": len(position_history),
    }

    # ------------------------------------------------------------------
    # 2. Agent Scorecards
    # ------------------------------------------------------------------
    agent_scorecards: dict[str, dict] = {}
    for name in evac_times:
        path = metrics.extract_agent_path(name, position_history)
        start = agent_start_positions.get(name, (0, 0))
        agent_scorecards[name] = {
            "survived": evac_times[name] is not None,
            "evacuationTime": evac_times[name],
            "startPosition": list(start),
            "path": [list(p) if isinstance(p, tuple) else p for p in path],
            "timeToFirstMove": metrics.compute_time_to_first_move(
                name, position_history
            ),
            "optimalPathRatio": metrics.compute_optimal_path_ratio(
                start, door_position, path
            ),
            "directionChanges": metrics.compute_direction_changes(path),
            # Deferred metrics (need message logs)
            "peopleHelped": 0,
            "peopleInfluenced": 0,
            "peopleHarmed": 0,
            # Deferred metrics (need fire/smoke data)
            "causeOfDeath": None,
            "injuryLevel": None,
            "finalPanicLevel": None,
            "timeInDangerZone": None,
        }

    # ------------------------------------------------------------------
    # 3. Group Dynamics
    # ------------------------------------------------------------------
    clusters = metrics.compute_clusters_per_step(position_history)
    bottleneck_events = metrics.compute_bottleneck_events(
        position_history, door_position
    )
    vulnerable_outcomes = metrics.compute_vulnerable_agent_outcomes(
        profiles, evac_times
    )

    group_dynamics = {
        "clustersFormed": clusters,
        "bottleneckEvents": bottleneck_events,
        "vulnerableAgentOutcomes": vulnerable_outcomes,
        # Deferred metrics (need message logs)
        "leadersEmerged": [],
        "cooperationRatio": None,
        "informationPropagationSpeed": None,
        "conflictEvents": [],
    }

    # ------------------------------------------------------------------
    # 4. Spatial Analysis
    # ------------------------------------------------------------------
    exit_utilization = metrics.compute_exit_utilization(evac_times, exits)
    # Exit balance score: with 1 exit it's trivially 1.0
    exit_balance_score = 1.0 if len(exits) == 1 else None

    spatial_analysis = {
        "exitUtilization": exit_utilization,
        "exitBalanceScore": exit_balance_score,
        "peakBottleneckDensity": metrics.compute_peak_bottleneck_density(
            position_history, door_position
        ),
        "wastedExitCapacity": metrics.compute_wasted_exit_capacity(
            position_history, door_position
        ),
        # Deferred metrics (need fire/smoke data)
        "casualtyHeatmap": None,
        "dangerVsEvacuationTimeline": None,
        "stampedeEvents": [],
    }

    return {
        "simulationOverview": simulation_overview,
        "agentScorecards": agent_scorecards,
        "groupDynamics": group_dynamics,
        "spatialAnalysis": spatial_analysis,
    }


def save_results(
    results: dict, path: str = "results/run_results.json"
) -> Path:
    """Write results dict as JSON with indent=2."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    return out
