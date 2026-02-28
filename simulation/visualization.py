from __future__ import annotations

import matplotlib.pyplot as plt
import matplotlib.animation as animation
import matplotlib.patches as mpatches
import numpy as np


_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"]


def animate(
    history: list[dict],
    width: int,
    height: int,
    door_position: tuple[int, int],
    interval_ms: int = 1200,
):
    """
    Play back a recorded simulation as a matplotlib animation.

    history: list of dicts, one per step.
             Each dict maps agent name -> (x, y) or "exited".
    width, height: grid dimensions.
    door_position: (x, y) of the exit door.
    interval_ms: milliseconds between frames.
    """
    agent_names = list(history[0].keys())
    color_map = {name: _COLORS[i % len(_COLORS)] for i, name in enumerate(agent_names)}

    fig, ax = plt.subplots(figsize=(8, 8))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#16213e")

    # Grid lines
    for x in range(width + 1):
        ax.axvline(x - 0.5, color="#0f3460", linewidth=0.5, zorder=0)
    for y in range(height + 1):
        ax.axhline(y - 0.5, color="#0f3460", linewidth=0.5, zorder=0)

    ax.set_xlim(-0.5, width - 0.5)
    ax.set_ylim(-0.5, height - 0.5)
    ax.set_xticks(range(width))
    ax.set_yticks(range(height))
    ax.tick_params(colors="gray", labelsize=7)

    # Door marker (static)
    dx, dy = door_position
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

    # Legend
    legend_patches = [mpatches.Patch(color=color_map[n], label=n) for n in agent_names]
    legend_patches.append(
        mpatches.Patch(facecolor="#f39c1244", edgecolor="#f1c40f", label="Door")
    )
    ax.legend(handles=legend_patches, loc="upper right", facecolor="#0f3460", labelcolor="white")

    title = ax.set_title("", color="white", fontsize=13, pad=10)

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

    def update(frame):
        step_data = history[frame]
        active = sum(1 for v in step_data.values() if v != "exited")
        title.set_text(f"Step {frame + 1} / {len(history)}  |  {active} agents remaining")

        for name, pos in step_data.items():
            if pos == "exited":
                scatters[name].set_offsets(np.array([[-10, -10]]))
                labels[name].set_position((-10, -10))
            else:
                x, y = pos
                scatters[name].set_offsets(np.array([[x, y]]))
                labels[name].set_position((x, y + 0.35))

        return list(scatters.values()) + list(labels.values()) + [title]

    ani = animation.FuncAnimation(
        fig,
        update,
        frames=len(history),
        interval=interval_ms,
        blit=False,
        repeat=True,
    )

    plt.tight_layout()
    plt.show()
    return ani
