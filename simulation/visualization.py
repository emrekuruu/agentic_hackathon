from __future__ import annotations

import matplotlib.pyplot as plt
import matplotlib.animation as animation
import matplotlib.patches as mpatches
from matplotlib.colors import ListedColormap
import numpy as np


_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"]


def animate(
    history: list[dict],
    width: int,
    height: int,
    door_positions: list[tuple[int, int]],
    obstacles: list[tuple[int, int]] | None = None,
    fire_history: list[list[list[int]]] | None = None,
    interval_ms: int = 800,
    smooth_substeps: int = 6,
):
    """
    Play back a recorded simulation as a matplotlib animation.

    history: list of dicts, one per step.
             Each dict maps agent name -> (x, y) or "exited".
    width, height: grid dimensions.
    door_positions: list of (x, y) exit door positions.
    interval_ms: milliseconds between frames.
    """
    agent_names = list(history[0].keys())
    color_map = {name: _COLORS[i % len(_COLORS)] for i, name in enumerate(agent_names)}

    fig, ax = plt.subplots(figsize=(8, 8))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#16213e")

    ax.set_xlim(-0.5, width - 0.5)
    ax.set_ylim(-0.5, height - 0.5)
    ax.set_aspect("equal")
    ax.set_axis_off()

    # Door markers (static)
    for dx, dy in door_positions:
        door_rect = mpatches.FancyBboxPatch(
            (dx - 0.45, dy - 0.45), 0.9, 0.9,
            boxstyle="round,pad=0.05",
            linewidth=2, edgecolor="#f1c40f", facecolor="#f39c1244",
            zorder=2,
        )
        ax.add_patch(door_rect)
        ax.text(
            dx, dy, "EXIT", ha="center", va="center",
            fontsize=7, color="#f1c40f", fontweight="bold", zorder=3,
        )

    # Obstacle markers (static)
    for ox, oy in (obstacles or []):
        wall = mpatches.FancyBboxPatch(
            (ox - 0.45, oy - 0.45), 0.9, 0.9,
            boxstyle="round,pad=0.02",
            linewidth=1, edgecolor="#555577", facecolor="#2c2c54",
            zorder=2,
        )
        ax.add_patch(wall)
        ax.text(
            ox, oy, "▓", ha="center", va="center",
            fontsize=12, color="#555577", zorder=3,
        )

    # Legend
    legend_patches = [mpatches.Patch(color=color_map[n], label=n) for n in agent_names]
    legend_patches.append(
        mpatches.Patch(facecolor="#f39c1244", edgecolor="#f1c40f", label="Door")
    )
    if obstacles:
        legend_patches.append(
            mpatches.Patch(facecolor="#2c2c54", edgecolor="#555577", label="Wall")
        )
    if fire_history:
        legend_patches.append(
            mpatches.Patch(facecolor="#ff0000", edgecolor="#ff0000", label="Fire")
        )
    ax.legend(handles=legend_patches, loc="upper right", facecolor="#0f3460", labelcolor="white")

    title = ax.set_title("", color="white", fontsize=13, pad=10)
    fire_im = ax.imshow(
        np.zeros((height, width), dtype=int),
        origin="lower",
        interpolation="nearest",
        extent=(-0.5, width - 0.5, -0.5, height - 0.5),
        cmap=ListedColormap([(0.0, 0.0, 0.0, 0.0), (1.0, 0.0, 0.0, 1.0)]),
        vmin=0,
        vmax=1,
        zorder=4,
    )

    # One scatter + label per agent
    scatters: dict = {}
    labels: dict = {}
    for name in agent_names:
        first = history[0][name]
        x0, y0 = first if first != "exited" else (-10, -10)
        sc = ax.scatter(
            x0, y0,
            s=500, c=color_map[name],
            zorder=5, edgecolors="white", linewidths=1.5,
        )
        lbl = ax.text(
            x0, y0 + 0.35, name[0],
            ha="center", va="center",
            fontsize=9, color="white", fontweight="bold", zorder=6,
        )
        scatters[name] = sc
        labels[name] = lbl

    smooth_substeps = max(1, int(smooth_substeps))
    if len(history) <= 1:
        total_frames = len(history)
    else:
        total_frames = 1 + (len(history) - 1) * smooth_substeps

    def _interp_pos(p0, p1, alpha: float):
        if p0 == "exited" and p1 == "exited":
            return None
        if p0 == "exited" and p1 != "exited":
            return tuple(p1)
        if p0 != "exited" and p1 == "exited":
            return tuple(p0) if alpha < 1.0 else None
        x = (1.0 - alpha) * p0[0] + alpha * p1[0]
        y = (1.0 - alpha) * p0[1] + alpha * p1[1]
        return (x, y)

    def update(frame):
        if len(history) <= 1 or smooth_substeps == 1:
            base_idx = min(frame, len(history) - 1)
            next_idx = base_idx
            alpha = 0.0
        else:
            base_idx = min(frame // smooth_substeps, len(history) - 1)
            next_idx = min(base_idx + 1, len(history) - 1)
            alpha = (frame % smooth_substeps) / smooth_substeps if next_idx > base_idx else 0.0

        step_data = history[base_idx]
        next_data = history[next_idx]
        active = sum(1 for v in step_data.values() if v != "exited")
        title.set_text(f"Step {base_idx + 1} / {len(history)}  |  {active} agents remaining")

        for name in agent_names:
            pos = _interp_pos(step_data[name], next_data[name], alpha)
            if pos is None:
                scatters[name].set_offsets(np.array([[-10, -10]]))
                labels[name].set_position((-10, -10))
            else:
                x, y = pos
                scatters[name].set_offsets(np.array([[x, y]]))
                labels[name].set_position((x, y + 0.35))

        frame_fires = []
        fire_idx = base_idx if alpha < 0.5 else next_idx
        if fire_history and fire_idx < len(fire_history):
            frame_fires = fire_history[fire_idx]
        fire_grid = np.zeros((height, width), dtype=int)
        for fx, fy in frame_fires:
            if 0 <= fx < width and 0 <= fy < height:
                fire_grid[fy, fx] = 1
        fire_im.set_data(fire_grid)

        return list(scatters.values()) + list(labels.values()) + [title, fire_im]

    ani = animation.FuncAnimation(
        fig,
        update,
        frames=total_frames,
        interval=max(16, interval_ms // smooth_substeps),
        blit=False,
        repeat=True,
    )

    plt.tight_layout()
    plt.show()
    return ani
