from __future__ import annotations

import textwrap

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
    speech_history: list[dict] | None = None,
    obstacles: list[tuple[int, int]] | None = None,
    interval_ms: int = 2500,
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

    fig, ax = plt.subplots(figsize=(11, 8))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#16213e")
    fig.subplots_adjust(left=0.06, right=0.7, top=0.92, bottom=0.08)

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
    ax.legend(handles=legend_patches, loc="upper right", facecolor="#0f3460", labelcolor="white")

    title = ax.set_title("", color="white", fontsize=13, pad=10)
    message_panel = fig.text(
        0.72,
        0.9,
        "",
        ha="left",
        va="top",
        fontsize=8,
        color="white",
        family="monospace",
        bbox=dict(
            boxstyle="round,pad=0.5",
            facecolor="#0f3460",
            edgecolor="#1f6fb2",
            alpha=0.95,
        ),
    )

    # One scatter + label + speech bubble per agent
    scatters: dict = {}
    labels: dict = {}
    bubbles: dict = {}
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
        bubble = ax.text(
            -10, -10, "",
            ha="center", va="bottom",
            fontsize=7, color="#1a1a2e",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.92, edgecolor=color_map[name], linewidth=1.5),
            zorder=7, visible=False,
            wrap=True,
        )
        scatters[name] = sc
        labels[name] = lbl
        bubbles[name] = bubble

    def update(frame):
        step_data = history[frame]
        active = sum(1 for v in step_data.values() if v != "exited")
        title.set_text(f"Step {frame + 1} / {len(history)}  |  {active} agents remaining")

        speech_data = speech_history[frame] if speech_history else {}

        for name, pos in step_data.items():
            if pos == "exited":
                scatters[name].set_offsets(np.array([[-10, -10]]))
                labels[name].set_position((-10, -10))
                bubbles[name].set_visible(False)
            else:
                x, y = pos
                scatters[name].set_offsets(np.array([[x, y]]))
                labels[name].set_position((x, y + 0.35))

                msg = speech_data.get(name)
                if msg:
                    wrapped = textwrap.fill(msg, width=34)
                    bubbles[name].set_text(f'"{wrapped}"')
                    bubbles[name].set_position((x, y + 0.55))
                    bubbles[name].set_visible(True)
                else:
                    bubbles[name].set_visible(False)

        spoken_messages = [
            f"{name}: {speech_data[name]}"
            for name in agent_names
            if speech_data.get(name)
        ]
        if spoken_messages:
            panel_text = "\n\n".join(textwrap.fill(line, width=52) for line in spoken_messages)
            message_panel.set_text(f"Messages this step:\n\n{panel_text}")
        else:
            message_panel.set_text("Messages this step:\n\n(none)")

        return (
            list(scatters.values())
            + list(labels.values())
            + list(bubbles.values())
            + [title, message_panel]
        )

    ani = animation.FuncAnimation(
        fig,
        update,
        frames=len(history),
        interval=interval_ms,
        blit=False,
        repeat=True,
    )

    plt.tight_layout(rect=(0, 0, 0.7, 1))
    plt.show()
    return ani
