from __future__ import annotations

import matplotlib.pyplot as plt
import matplotlib.animation as animation
import matplotlib.patches as mpatches
from matplotlib.colors import ListedColormap
import numpy as np


_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"]


def _fit_rect_within_grid(
    cx: float, cy: float, size: float, width: int, height: int
) -> tuple[float, float, float, float]:
    """Keep a square fully visible by shifting it inside plot bounds."""
    half = size / 2.0
    x0, x1 = cx - half, cx + half
    y0, y1 = cy - half, cy + half
    min_x, max_x = -0.5, width - 0.5
    min_y, max_y = -0.5, height - 0.5

    if x0 < min_x:
        shift = min_x - x0
        x0 += shift
        x1 += shift
    if x1 > max_x:
        shift = x1 - max_x
        x0 -= shift
        x1 -= shift
    if y0 < min_y:
        shift = min_y - y0
        y0 += shift
        y1 += shift
    if y1 > max_y:
        shift = y1 - max_y
        y0 -= shift
        y1 -= shift

    return x0, y0, x1, y1


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

    fig, ax = plt.subplots(figsize=(13, 8))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#16213e")

    ax.set_xlim(-0.5, width - 0.5)
    ax.set_ylim(-0.5, height - 0.5)
    ax.set_aspect("equal")
    ax.set_axis_off()

    # Door markers (static)
    door_size = 2.6
    for dx, dy in door_positions:
        x0, y0, x1, y1 = _fit_rect_within_grid(dx, dy, door_size, width, height)
        cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        door_rect = mpatches.FancyBboxPatch(
            (x0, y0), x1 - x0, y1 - y0,
            boxstyle="round,pad=0.05",
            linewidth=3.6, edgecolor="#ffff00", facecolor="#ffff00",
            zorder=2,
        )
        ax.add_patch(door_rect)
        ax.text(
            cx, cy, "EXIT", ha="center", va="center",
            fontsize=9, color="#1a1a2e", fontweight="bold", zorder=3,
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
        mpatches.Patch(facecolor="#ffff00", edgecolor="#ffff00", label="Door")
    )
    if obstacles:
        legend_patches.append(
            mpatches.Patch(facecolor="#2c2c54", edgecolor="#555577", label="Wall")
        )
    if fire_history:
        legend_patches.append(
            mpatches.Patch(facecolor="#ff0000", edgecolor="#ff0000", label="Fire")
        )
    ax.legend(
        handles=legend_patches,
        loc="upper left",
        bbox_to_anchor=(1.3, 1.0),
        borderaxespad=0.0,
        facecolor="#0f3460",
        labelcolor="white",
    )

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

    # One marker + label per agent (marker is in data units so scale stays consistent)
    markers: dict = {}
    labels: dict = {}
    for name in agent_names:
        first = history[0][name]
        x0, y0 = first if first != "exited" else (0, 0)
        marker = mpatches.Circle(
            (x0, y0),
            radius=0.33,
            facecolor=color_map[name],
            edgecolor="white",
            linewidth=1.2,
            zorder=5,
        )
        marker.set_visible(first != "exited")
        ax.add_patch(marker)
        lbl = ax.text(
            x0, y0 + 0.35, name[0],
            ha="center", va="center",
            fontsize=9, color="white", fontweight="bold", zorder=6,
        )
        lbl.set_visible(first != "exited")
        markers[name] = marker
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
                markers[name].set_visible(False)
                labels[name].set_visible(False)
            else:
                x, y = pos
                markers[name].center = (x, y)
                markers[name].set_visible(True)
                labels[name].set_position((x, y + 0.35))
                labels[name].set_visible(True)

        frame_fires = []
        fire_idx = base_idx if alpha < 0.5 else next_idx
        if fire_history and fire_idx < len(fire_history):
            frame_fires = fire_history[fire_idx]
        fire_grid = np.zeros((height, width), dtype=int)
        for fx, fy in frame_fires:
            if 0 <= fx < width and 0 <= fy < height:
                fire_grid[fy, fx] = 1
        fire_im.set_data(fire_grid)

        return list(markers.values()) + list(labels.values()) + [title, fire_im]

    ani = animation.FuncAnimation(
        fig,
        update,
        frames=total_frames,
        interval=max(16, interval_ms // smooth_substeps),
        blit=False,
        repeat=True,
    )

    fig.subplots_adjust(right=0.5, left=0.04, top=0.95, bottom=0.04)
    plt.show()
    return ani
