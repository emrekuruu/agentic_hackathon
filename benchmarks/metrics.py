"""Pure metric computation functions for evacuation simulation benchmarks.

All functions take position_history + config as input and return computed values.
No side effects.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Section 1: Simulation Overview
# ---------------------------------------------------------------------------


def compute_evacuation_times(
    position_history: list[dict[str, tuple | str]],
) -> dict[str, int | None]:
    """For each agent, find the first step where value == "exited".

    Returns {agent_name: step_number_or_None}.
    Steps are 1-indexed (the step number in which the agent first appears as "exited").
    """
    if not position_history:
        return {}

    agents = position_history[0].keys()
    evac_times: dict[str, int | None] = {name: None for name in agents}

    for step_idx, snapshot in enumerate(position_history):
        step_number = step_idx + 1  # 1-indexed
        for name in agents:
            if evac_times[name] is not None:
                continue
            if snapshot.get(name) == "exited":
                evac_times[name] = step_number

    return evac_times


def compute_survival_rate(evac_times: dict[str, int | None]) -> float:
    """Fraction of agents that successfully evacuated."""
    if not evac_times:
        return 0.0
    evacuated = sum(1 for t in evac_times.values() if t is not None)
    return evacuated / len(evac_times)


def compute_mean_evacuation_time(evac_times: dict[str, int | None]) -> float | None:
    """Mean evacuation time among agents that exited. None if nobody exited."""
    times = [t for t in evac_times.values() if t is not None]
    if not times:
        return None
    return sum(times) / len(times)


def compute_last_evacuation_time(evac_times: dict[str, int | None]) -> int | None:
    """Step at which the last agent evacuated. None if nobody exited."""
    times = [t for t in evac_times.values() if t is not None]
    return max(times) if times else None


def compute_time_to_first_evacuation(evac_times: dict[str, int | None]) -> int | None:
    """Step at which the first agent evacuated. None if nobody exited."""
    times = [t for t in evac_times.values() if t is not None]
    return min(times) if times else None


def compute_time_to_50_percent(evac_times: dict[str, int | None]) -> int | None:
    """Step by which at least 50% of all agents had evacuated. None if <50% exited."""
    total = len(evac_times)
    if total == 0:
        return None
    threshold = total / 2
    times = sorted(t for t in evac_times.values() if t is not None)
    evacuated = 0
    for t in times:
        evacuated += 1
        if evacuated >= threshold:
            return t
    return None


# ---------------------------------------------------------------------------
# Section 2: Per-Agent Scorecards
# ---------------------------------------------------------------------------


def extract_agent_path(
    name: str, position_history: list[dict]
) -> list[tuple[int, int] | str]:
    """Extract the sequence of positions for a single agent.

    Positions are (x, y) tuples while on the grid, then "exited" once evacuated.
    """
    path: list[tuple[int, int] | str] = []
    for snapshot in position_history:
        val = snapshot.get(name)
        if val == "exited":
            path.append("exited")
        elif val is not None:
            path.append(tuple(val))
        else:
            path.append("exited")
    return path


def compute_time_to_first_move(
    name: str, position_history: list[dict]
) -> int | None:
    """Step when agent's position first differs from step 0.

    Returns None if the agent never moved (or there's no history).
    """
    if not position_history:
        return None

    start = position_history[0].get(name)
    if start is None or start == "exited":
        return None

    for step_idx in range(1, len(position_history)):
        pos = position_history[step_idx].get(name)
        if pos != start:
            return step_idx + 1  # 1-indexed
    return None


def _chebyshev_distance(a: tuple[int, int], b: tuple[int, int]) -> int:
    """Chebyshev (chessboard) distance between two grid positions."""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def compute_optimal_path_ratio(
    start_pos: tuple[int, int],
    door_pos: tuple[int, int],
    path: list[tuple[int, int] | str],
) -> float:
    """Ratio of Chebyshev-optimal steps to actual steps taken before exit.

    Returns 1.0 = perfect, <1.0 = inefficient, 0.0 = never exited.
    """
    optimal = _chebyshev_distance(start_pos, door_pos)
    if optimal == 0:
        return 1.0

    # Count actual movement steps before "exited"
    actual_steps = 0
    for i in range(1, len(path)):
        if path[i] == "exited":
            break
        if path[i] != path[i - 1]:
            actual_steps += 1

    if actual_steps == 0:
        # Agent never moved or never exited
        exited = any(p == "exited" for p in path)
        return 1.0 if exited and optimal == 0 else 0.0

    return min(optimal / actual_steps, 1.0)


def compute_direction_changes(path: list[tuple[int, int] | str]) -> int:
    """Count times the movement vector (dx, dy) changes between consecutive moves."""
    # Build list of movement vectors (skip stationary steps and "exited")
    vectors: list[tuple[int, int]] = []
    for i in range(1, len(path)):
        if path[i] == "exited" or path[i - 1] == "exited":
            break
        prev = path[i - 1]
        curr = path[i]
        if curr != prev:
            vectors.append((curr[0] - prev[0], curr[1] - prev[1]))

    changes = 0
    for i in range(1, len(vectors)):
        if vectors[i] != vectors[i - 1]:
            changes += 1
    return changes


# ---------------------------------------------------------------------------
# Section 3: Group Dynamics
# ---------------------------------------------------------------------------


def _union_find_clusters(
    agents: dict[str, tuple[int, int]], distance_threshold: int
) -> list[list[str]]:
    """Find connected components of agents within Chebyshev distance threshold."""
    names = list(agents.keys())
    parent = {n: n for n in names}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            if _chebyshev_distance(agents[names[i]], agents[names[j]]) <= distance_threshold:
                union(names[i], names[j])

    clusters: dict[str, list[str]] = {}
    for n in names:
        root = find(n)
        clusters.setdefault(root, []).append(n)

    # Only return clusters of 2+ agents
    return [members for members in clusters.values() if len(members) >= 2]


def compute_clusters_per_step(
    position_history: list[dict], distance_threshold: int = 2
) -> list[list[list[str]]]:
    """Per-step list of clusters (groups of 2+ agents within Chebyshev distance).

    Returns list (one entry per step) of list of clusters.
    """
    result: list[list[list[str]]] = []
    for snapshot in position_history:
        active = {
            name: tuple(pos)
            for name, pos in snapshot.items()
            if pos != "exited"
        }
        clusters = _union_find_clusters(active, distance_threshold)
        result.append(clusters)
    return result


def compute_bottleneck_events(
    position_history: list[dict],
    door_pos: tuple[int, int],
    threshold: int = 3,
) -> list[dict]:
    """Steps where agents near the door exceed threshold.

    "Near" = Chebyshev distance <= 1 from door_pos.
    Returns list of {step, agentCount, agents}.
    """
    events: list[dict] = []
    for step_idx, snapshot in enumerate(position_history):
        near_door = []
        for name, pos in snapshot.items():
            if pos == "exited":
                continue
            if _chebyshev_distance(tuple(pos), door_pos) <= 1:
                near_door.append(name)
        if len(near_door) >= threshold:
            events.append({
                "step": step_idx + 1,
                "agentCount": len(near_door),
                "agents": sorted(near_door),
            })
    return events


def compute_vulnerable_agent_outcomes(
    profiles: list[dict] | None, evac_times: dict[str, int | None]
) -> dict:
    """Cross-reference profile attributes (age, mobility) with evacuation success.

    Vulnerable = age < 12 or age > 65 or mobility < 40.
    """
    if not profiles:
        return {"vulnerable": [], "nonVulnerable": [], "summary": None}

    vulnerable: list[dict] = []
    non_vulnerable: list[dict] = []

    for profile in profiles:
        name = profile.get("name", "")
        age = profile.get("age", 30)
        mobility = (
            profile.get("attributes", {})
            .get("physical", {})
            .get("mobility", 100)
        )

        is_vulnerable = age < 12 or age > 65 or mobility < 40
        evacuated = evac_times.get(name) is not None
        entry = {
            "name": name,
            "age": age,
            "mobility": mobility,
            "evacuated": evacuated,
            "evacuationTime": evac_times.get(name),
        }

        if is_vulnerable:
            vulnerable.append(entry)
        else:
            non_vulnerable.append(entry)

    vuln_evacuated = sum(1 for v in vulnerable if v["evacuated"])
    total_vuln = len(vulnerable)

    return {
        "vulnerable": vulnerable,
        "nonVulnerable": non_vulnerable,
        "summary": {
            "totalVulnerable": total_vuln,
            "vulnerableEvacuated": vuln_evacuated,
            "vulnerableSurvivalRate": (
                vuln_evacuated / total_vuln if total_vuln > 0 else None
            ),
        },
    }


# ---------------------------------------------------------------------------
# Section 4: Spatial & Structural
# ---------------------------------------------------------------------------


def compute_peak_bottleneck_density(
    position_history: list[dict], door_pos: tuple[int, int], radius: int = 1
) -> int:
    """Max agents within radius of door in any single step."""
    peak = 0
    for snapshot in position_history:
        count = 0
        for name, pos in snapshot.items():
            if pos == "exited":
                continue
            if _chebyshev_distance(tuple(pos), door_pos) <= radius:
                count += 1
        peak = max(peak, count)
    return peak


def compute_wasted_exit_capacity(
    position_history: list[dict], door_pos: tuple[int, int]
) -> int:
    """Steps where the door cell was empty but agents were still on the grid."""
    wasted = 0
    for snapshot in position_history:
        agents_on_grid = [
            name for name, pos in snapshot.items() if pos != "exited"
        ]
        if not agents_on_grid:
            continue
        door_occupied = any(
            tuple(pos) == door_pos
            for pos in snapshot.values()
            if pos != "exited"
        )
        if not door_occupied:
            wasted += 1
    return wasted


def compute_exit_utilization(
    evac_times: dict[str, int | None],
    exits: list[tuple[int, int]],
) -> dict[str, int]:
    """Per-exit count of agents that used it.

    With a single exit, all evacuated agents used that exit.
    """
    evacuated_count = sum(1 for t in evac_times.values() if t is not None)
    # With a single exit, attribute all evacuations to it
    result: dict[str, int] = {}
    for exit_pos in exits:
        key = f"({exit_pos[0]},{exit_pos[1]})"
        result[key] = evacuated_count
    return result
