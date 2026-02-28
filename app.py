"""Evacuation Simulator — Streamlit Web UI

Run with:
    streamlit run app.py
"""

from __future__ import annotations

import json

import plotly.graph_objects as go
import streamlit as st
import yaml
from dotenv import load_dotenv

load_dotenv()

# ── Page Config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Evacuation Simulator",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Theme CSS ─────────────────────────────────────────────────────────────────
st.markdown(
    """
<style>
/* ── global ── */
html, body, [data-testid="stAppViewContainer"] {
    background-color: #1a1a2e !important;
    color: #e0e0e0;
}
[data-testid="stSidebar"] {
    background-color: #16213e !important;
    border-right: 2px solid #0f3460;
}
[data-testid="stSidebar"] * { color: #d0d0d0 !important; }
[data-testid="stMain"] { background-color: #1a1a2e !important; }
section[data-testid="stMain"] > div { background-color: #1a1a2e !important; }

/* hide default streamlit chrome */
#MainMenu, footer { visibility: hidden; }
header[data-testid="stHeader"] { background: transparent; }

/* ── header bar ── */
.evac-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 18px;
    background: linear-gradient(90deg, #0f3460 0%, #16213e 100%);
    border-bottom: 2px solid #1f6fb2;
    border-radius: 6px;
    margin-bottom: 14px;
}
.evac-title {
    font-size: 1.3rem;
    font-weight: 800;
    color: #4fc3f7;
    letter-spacing: 0.4px;
}
.evac-sub {
    margin-left: auto;
    font-size: 0.78rem;
    color: #7f8c8d;
}

/* ── status badges ── */
.badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 11px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.5px;
}
.badge-idle    { background:#2c3e50; color:#95a5a6; border:1px solid #7f8c8d; }
.badge-running { background:#1a5276; color:#5dade2; border:1px solid #5dade2; }
.badge-done    { background:#1e8449; color:#2ecc71; border:1px solid #2ecc71; }

/* ── status bar ── */
.sim-bar {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 8px 12px;
    background: #16213e;
    border-radius: 6px;
    border: 1px solid #0f3460;
    margin-bottom: 10px;
    font-size: 0.84rem;
}
.sim-bar .lbl { color: #7f8c8d; }
.sim-bar .val { color: #4fc3f7; font-weight: 700; font-family: 'Courier New', monospace; }
.sim-bar .val-green { color: #2ecc71; font-weight: 700; }
.sim-bar .val-red   { color: #e74c3c; font-weight: 700; }

/* ── section label ── */
.sec-title {
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: #4fc3f7;
    border-bottom: 1px solid #0f3460;
    padding-bottom: 4px;
    margin-bottom: 10px;
    margin-top: 14px;
}

/* ── metric card ── */
.metric-card {
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    padding: 10px 12px;
    text-align: center;
    margin-bottom: 7px;
}
.mc-label { font-size: 0.65rem; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
.mc-value { font-size: 1.35rem; font-weight: 800; font-family: 'Courier New', monospace; color: #4fc3f7; }
.mc-value.ok   { color: #2ecc71; }
.mc-value.warn { color: #f39c12; }
.mc-value.bad  { color: #e74c3c; }

/* ── agent row ── */
.agent-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 9px;
    background: #16213e;
    border-radius: 4px;
    margin-bottom: 5px;
    font-size: 0.82rem;
}
.agent-name  { color: #e0e0e0; font-weight: 600; }
.agent-pos   { margin-left: auto; color: #7f8c8d; font-family: monospace; font-size: 0.72rem; }

/* ── message panel ── */
.msg-panel {
    background: #0f3460;
    border: 1px solid #1f6fb2;
    border-radius: 6px;
    padding: 12px 14px;
    font-family: 'Courier New', monospace;
    font-size: 0.79rem;
    color: #e0e0e0;
    min-height: 70px;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 8px;
}
.msg-entry { margin-bottom: 8px; line-height: 1.4; }

/* ── control row ── */
.stButton > button {
    background-color: #0f3460 !important;
    color: #e0e0e0 !important;
    border: 1px solid #1f6fb2 !important;
    border-radius: 4px !important;
    font-weight: 600 !important;
    font-size: 0.82rem !important;
}
.stButton > button:hover {
    background-color: #1f6fb2 !important;
    color: #ffffff !important;
    border-color: #4fc3f7 !important;
}
.stButton > button:disabled {
    opacity: 0.4 !important;
    cursor: not-allowed !important;
}

/* ── slider ── */
[data-testid="stSlider"] label { color: #7f8c8d !important; font-size: 0.75rem !important; }

/* ── sidebar inputs ── */
.stTextInput input, .stNumberInput input, .stTextArea textarea {
    background-color: #0f3460 !important;
    color: #e0e0e0 !important;
    border-color: #1f6fb2 !important;
}
.stSelectbox > div > div {
    background-color: #0f3460 !important;
    color: #e0e0e0 !important;
}

/* ── expander ── */
[data-testid="stExpander"] {
    border-color: #0f3460 !important;
    background: #16213e !important;
}
[data-testid="stExpander"] summary { color: #4fc3f7 !important; }
</style>
""",
    unsafe_allow_html=True,
)

# ── Constants ─────────────────────────────────────────────────────────────────
AGENT_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"]

LLM_MODELS = [
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "openai/gpt-5.2",
    "anthropic/claude-haiku-4-5-20251001",
    "anthropic/claude-sonnet-4-6",
]

# ── Session State ─────────────────────────────────────────────────────────────
def _init():
    defaults: dict = {
        "sim_status": "idle",
        "position_history": [],
        "speech_history": [],
        "current_step": 0,
        "config": _load_default_cfg(),
        "results": None,
        "profiles": _load_profiles_map(),
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


def _load_profiles_map() -> dict:
    """Load profiles.json into a {name: profile} dict, if it exists."""
    try:
        with open("profiles.json") as f:
            data = json.load(f)
        return {p["name"]: p for p in data.get("profiles", [])}
    except Exception:
        return {}


def _load_default_cfg() -> dict:
    try:
        with open("configs/agents.yaml") as f:
            return yaml.safe_load(f)
    except Exception:
        return {
            "environment": {
                "width": 10,
                "height": 10,
                "deadline": 20,
                "llm_model": "openai/gpt-4o-mini",
                "door": [9, 5],
                "obstacles": [[7, 6], [8, 6], [9, 6]],
            },
            "agents": [
                {"name": "Alice", "role": "domain expert",
                 "personality": "Analytical, skeptical, data-driven.", "position": [7, 7]},
                {"name": "Bob", "role": "novice user",
                 "personality": "Enthusiastic, curious, open-minded.", "position": [7, 8]},
                {"name": "Carol", "role": "facilitator",
                 "personality": "Calm, neutral, focused on consensus.", "position": [2, 7]},
            ],
        }


_init()

# ── Grid Figure ───────────────────────────────────────────────────────────────
def _build_figure(step: int) -> go.Figure:
    cfg = st.session_state.config
    env = cfg["environment"]
    W, H = env["width"], env["height"]
    door = tuple(env["door"])
    obstacles = [tuple(o) for o in env.get("obstacles", [])]
    agents_cfg: list[dict] = cfg["agents"]
    color_map = {a["name"]: AGENT_COLORS[i % len(AGENT_COLORS)] for i, a in enumerate(agents_cfg)}

    pos_hist = st.session_state.position_history
    spk_hist = st.session_state.speech_history

    fig = go.Figure()

    # ── grid cells ──
    for x in range(W):
        for y in range(H):
            fig.add_shape(
                type="rect",
                x0=x - 0.5, y0=y - 0.5, x1=x + 0.5, y1=y + 0.5,
                fillcolor="#16213e",
                line=dict(color="#0f3460", width=0.5),
                layer="below",
            )

    # ── obstacles ──
    for ox, oy in obstacles:
        fig.add_shape(
            type="rect",
            x0=ox - 0.44, y0=oy - 0.44, x1=ox + 0.44, y1=oy + 0.44,
            fillcolor="#2c2c54",
            line=dict(color="#555577", width=1.5),
        )
        fig.add_annotation(
            x=ox, y=oy, text="▓",
            font=dict(size=16, color="#555577"),
            showarrow=False,
        )

    # ── door ──
    dx, dy = door
    fig.add_shape(
        type="rect",
        x0=dx - 0.44, y0=dy - 0.44, x1=dx + 0.44, y1=dy + 0.44,
        fillcolor="rgba(243,156,18,0.20)",
        line=dict(color="#f1c40f", width=2.5),
    )
    fig.add_annotation(
        x=dx, y=dy, text="EXIT",
        font=dict(size=9, color="#f1c40f", family="Arial Black"),
        showarrow=False,
    )

    # ── agents ──
    step_data: dict = pos_hist[step] if pos_hist and step < len(pos_hist) else {}
    speech_data: dict = spk_hist[step] if spk_hist and step < len(spk_hist) else {}

    for i, agent in enumerate(agents_cfg):
        name = agent["name"]
        color = color_map[name]

        # Position: from history if available, else from config
        if step_data:
            raw = step_data.get(name)
            if raw == "exited" or raw is None:
                continue
            x, y = raw
        else:
            x, y = agent["position"]

        fig.add_trace(
            go.Scatter(
                x=[x], y=[y],
                mode="markers+text",
                marker=dict(
                    size=28,
                    color=color,
                    line=dict(color="white", width=2),
                    opacity=0.95,
                ),
                text=[name[0]],
                textposition="middle center",
                textfont=dict(size=12, color="white", family="Arial Black"),
                name=name,
                hovertemplate=(
                    f"<b>{name}</b><br>"
                    f"Role: {agent['role']}<br>"
                    f"Position: ({x}, {y})<extra></extra>"
                ),
                showlegend=True,
            )
        )

        # Speech bubble
        msg = speech_data.get(name)
        if msg:
            short = (msg[:55] + "…") if len(msg) > 55 else msg
            fig.add_annotation(
                x=x, y=y + 0.72,
                text=f'"{short}"',
                font=dict(size=7, color="#1a1a2e"),
                bgcolor="white",
                bordercolor=color,
                borderwidth=1.5,
                borderpad=3,
                showarrow=True,
                arrowhead=2,
                arrowsize=0.5,
                arrowcolor=color,
                ax=0, ay=16,
            )

    # Exited agents shown as faded dots in legend
    if step_data:
        for i, agent in enumerate(agents_cfg):
            name = agent["name"]
            if step_data.get(name) == "exited":
                color = color_map[name]
                fig.add_trace(
                    go.Scatter(
                        x=[None], y=[None],
                        mode="markers",
                        marker=dict(size=14, color=color, opacity=0.35,
                                    line=dict(color="white", width=1)),
                        name=f"{name} ✓",
                        showlegend=True,
                    )
                )

    fig.update_layout(
        paper_bgcolor="#1a1a2e",
        plot_bgcolor="#16213e",
        margin=dict(l=8, r=8, t=8, b=8),
        xaxis=dict(
            range=[-0.5, W - 0.5],
            tickvals=list(range(W)),
            showgrid=False,
            zeroline=False,
            tickfont=dict(color="#4a4a6a", size=8),
        ),
        yaxis=dict(
            range=[-0.5, H - 0.5],
            tickvals=list(range(H)),
            showgrid=False,
            zeroline=False,
            tickfont=dict(color="#4a4a6a", size=8),
            scaleanchor="x",
        ),
        legend=dict(
            bgcolor="#0f3460",
            bordercolor="#1f6fb2",
            borderwidth=1,
            font=dict(color="white", size=10),
            x=0.01, y=0.99,
            xanchor="left",
            yanchor="top",
        ),
        height=520,
        dragmode=False,
    )
    return fig


# ── Simulation Runner ─────────────────────────────────────────────────────────
def _run_simulation():
    from simulation.model import EvaluationModel

    cfg = st.session_state.config
    env = cfg["environment"]
    door = tuple(env["door"])
    obstacles = [tuple(o) for o in env.get("obstacles", [])]

    model = EvaluationModel(
        width=env["width"],
        height=env["height"],
        deadline=env["deadline"],
        door_position=door,
        agent_configs=cfg["agents"],
        llm_model=env["llm_model"],
        obstacles=obstacles,
    )

    progress_placeholder = st.empty()
    step_count = 0
    while model.running:
        model.step()
        step_count += 1
        active = len(list(model.agents))
        progress_placeholder.markdown(
            f'<div class="sim-bar"><span class="lbl">Step</span>'
            f'<span class="val">{step_count}</span>'
            f'<span class="lbl">Active</span>'
            f'<span class="val">{active}</span></div>',
            unsafe_allow_html=True,
        )

    progress_placeholder.empty()

    st.session_state.position_history = model.position_history
    st.session_state.speech_history = model.speech_history
    st.session_state.current_step = 0
    st.session_state.sim_status = "complete"


# ─────────────────────────────────────────────────────────────────────────────
# SIDEBAR — Configuration
# ─────────────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown('<div class="sec-title">⚙ Environment</div>', unsafe_allow_html=True)

    cfg = st.session_state.config
    env = cfg["environment"]
    agents_cfg: list[dict] = cfg["agents"]

    with st.expander("Grid & Timing", expanded=True):
        c1, c2 = st.columns(2)
        with c1:
            env["width"] = st.number_input("Width", 5, 30, int(env["width"]), key="env_w")
            env["height"] = st.number_input("Height", 5, 30, int(env["height"]), key="env_h")
        with c2:
            env["deadline"] = st.number_input("Deadline", 5, 100, int(env["deadline"]), key="env_d")
            env["llm_model"] = st.selectbox(
                "LLM Model",
                LLM_MODELS,
                index=LLM_MODELS.index(env.get("llm_model", LLM_MODELS[0]))
                if env.get("llm_model") in LLM_MODELS
                else 0,
                key="env_model",
            )

        c3, c4 = st.columns(2)
        with c3:
            door_x = st.number_input("Door X", 0, env["width"] - 1, int(env["door"][0]), key="door_x")
        with c4:
            door_y = st.number_input("Door Y", 0, env["height"] - 1, int(env["door"][1]), key="door_y")
        env["door"] = [door_x, door_y]

    with st.expander("Obstacles", expanded=False):
        obs_raw = env.get("obstacles", [])
        obs_text = "\n".join(f"{o[0]},{o[1]}" for o in obs_raw)
        new_obs_text = st.text_area(
            "One obstacle per line (x,y)",
            value=obs_text,
            height=100,
            key="obs_input",
            help="Format: x,y  — e.g.  7,6",
        )
        parsed_obs = []
        for line in new_obs_text.strip().splitlines():
            line = line.strip()
            if "," in line:
                try:
                    parts = [int(p) for p in line.split(",")]
                    if len(parts) == 2:
                        parsed_obs.append(parts)
                except ValueError:
                    pass
        env["obstacles"] = parsed_obs

    st.markdown('<div class="sec-title">👥 Agents</div>', unsafe_allow_html=True)

    num_agents = st.number_input("Number of Agents", 1, 20, len(agents_cfg), key="num_agents")
    if st.button("🎲 Generate Random Agents"):
        from generate_profiles import generate_profiles, save_profiles

        door = tuple(env["door"])
        obstacles = [tuple(o) for o in env.get("obstacles", [])]
        profiles, new_agents = generate_profiles(
            n=num_agents,
            grid_width=env["width"],
            grid_height=env["height"],
            door_position=door,
            obstacles=obstacles,
        )
        save_profiles(profiles)
        st.session_state.config["agents"] = new_agents
        st.session_state.profiles = {p["name"]: p for p in profiles}
        st.rerun()

    if st.button("🎓 Load Hackathon Participants"):
        from hackathon_profiles import generate_hackathon_profiles
        from generate_profiles import save_profiles

        with st.spinner("Scraping LinkedIn & generating profiles (first run may take a few minutes)..."):
            profiles, new_agents = generate_hackathon_profiles(
                grid_width=env["width"],
                grid_height=env["height"],
                door_position=tuple(env["door"]),
                obstacles=[tuple(o) for o in env.get("obstacles", [])],
            )
        save_profiles(profiles, path="profiles_hackathon.json")
        st.session_state.config["agents"] = new_agents
        st.session_state.profiles = {p["name"]: p for p in profiles}
        st.rerun()

    for i, agent in enumerate(agents_cfg):
        with st.expander(f"{agent['name']}  ({agent['role']})", expanded=False):
            c1, c2 = st.columns(2)
            with c1:
                agent["name"] = st.text_input("Name", agent["name"], key=f"a_name_{i}")
                agent["role"] = st.text_input("Role", agent["role"], key=f"a_role_{i}")
            with c2:
                px = st.number_input("Start X", 0, env["width"] - 1, int(agent["position"][0]), key=f"a_x_{i}")
                py = st.number_input("Start Y", 0, env["height"] - 1, int(agent["position"][1]), key=f"a_y_{i}")
                agent["position"] = [px, py]
            agent["personality"] = st.text_area(
                "Personality", agent["personality"], height=68, key=f"a_pers_{i}"
            )
            # ── Show attributes from generated profiles ──
            prof_map: dict = st.session_state.get("profiles", {})
            prof = prof_map.get(agent["name"])
            if prof:
                st.markdown(
                    f"<span style='color:#7f8c8d;font-size:0.72rem;'>Age: {prof['age']} · {prof['description']}</span>",
                    unsafe_allow_html=True,
                )
                with st.expander("📊 Attributes", expanded=False):
                    for cat_name, cat_attrs in prof["attributes"].items():
                        label = cat_name.replace("_", " ").title()
                        st.markdown(
                            f"<span style='color:#4fc3f7;font-size:0.7rem;font-weight:700;"
                            f"text-transform:uppercase;letter-spacing:0.5px;'>{label}</span>",
                            unsafe_allow_html=True,
                        )
                        for attr_key, attr_val in cat_attrs.items():
                            pretty = attr_key.replace("_", " ").title()
                            bar_color = "#2ecc71" if attr_val >= 65 else "#f39c12" if attr_val >= 35 else "#e74c3c"
                            st.markdown(
                                f"<div style='display:flex;align-items:center;gap:6px;margin:1px 0;font-size:0.72rem;'>"
                                f"<span style='color:#aaa;min-width:130px;'>{pretty}</span>"
                                f"<div style='flex:1;background:#0a1628;border-radius:3px;height:8px;'>"
                                f"<div style='width:{attr_val}%;height:100%;background:{bar_color};border-radius:3px;'></div>"
                                f"</div>"
                                f"<span style='color:#ccc;font-family:monospace;min-width:24px;text-align:right;'>{attr_val}</span>"
                                f"</div>",
                                unsafe_allow_html=True,
                            )

            if st.button("🗑 Remove", key=f"rm_{i}"):
                agents_cfg.pop(i)
                st.rerun()

    if len(agents_cfg) < 6 and st.button("➕ Add Agent"):
        agents_cfg.append({
            "name": f"Agent{len(agents_cfg) + 1}",
            "role": "participant",
            "personality": "Calm and thoughtful.",
            "position": [0, 0],
        })
        st.rerun()

    st.markdown('<div class="sec-title">💾 Config File</div>', unsafe_allow_html=True)
    col_s, col_u = st.columns(2)
    with col_s:
        if st.button("Save", use_container_width=True):
            with open("configs/agents.yaml", "w") as f:
                yaml.dump(cfg, f, default_flow_style=False)
            st.success("Saved!")
    with col_u:
        uploaded = st.file_uploader("Load YAML", type=["yaml", "yml"], label_visibility="collapsed")
        if uploaded:
            st.session_state.config = yaml.safe_load(uploaded)
            st.rerun()

# ─────────────────────────────────────────────────────────────────────────────
# MAIN AREA
# ─────────────────────────────────────────────────────────────────────────────

# Header
st.markdown(
    """
<div class="evac-header">
    <span style="font-size:1.6rem;">🚨</span>
    <span class="evac-title">Evacuation Simulator</span>
    <span class="evac-sub">Multi-Agent LLM — Spatial Reasoning</span>
</div>
""",
    unsafe_allow_html=True,
)

pos_hist = st.session_state.position_history
spk_hist = st.session_state.speech_history
total_steps = len(pos_hist)
cur = st.session_state.current_step
sim_status = st.session_state.sim_status

# Derived counts
active_n = exited_n = 0
if pos_hist and cur < total_steps:
    frame = pos_hist[cur]
    active_n = sum(1 for v in frame.values() if v != "exited")
    exited_n = sum(1 for v in frame.values() if v == "exited")

badge_html = {
    "idle":     '<span class="badge badge-idle">⬤ IDLE</span>',
    "running":  '<span class="badge badge-running">⬤ RUNNING</span>',
    "complete": '<span class="badge badge-done">⬤ COMPLETE</span>',
}[sim_status]

survival_pct = (exited_n / len(agents_cfg) * 100) if agents_cfg else 0
deadline = int(env["deadline"])

st.markdown(
    f"""
<div class="sim-bar">
    {badge_html}
    <span class="lbl">T</span>
    <span class="val">{cur}&nbsp;/&nbsp;{total_steps or deadline}</span>
    <span class="lbl" style="margin-left:6px;">Active</span>
    <span class="val">{active_n}</span>
    <span class="lbl" style="margin-left:6px;">Exited</span>
    <span class="val-green">{exited_n}</span>
    <span class="lbl" style="margin-left:6px;">Survival</span>
    <span class="{'val-green' if survival_pct == 100 else 'val-red' if survival_pct < 50 and pos_hist else 'val'}">{survival_pct:.0f}%</span>
</div>
""",
    unsafe_allow_html=True,
)

# ── Two-column layout ─────────────────────────────────────────────────────────
col_canvas, col_panel = st.columns([3, 1], gap="medium")

with col_canvas:
    # Grid
    fig = _build_figure(cur)
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})

    # Controls
    c_run, c_first, c_prev, c_next, c_last, c_reset = st.columns([1.6, 0.8, 0.8, 0.8, 0.8, 1])
    with c_run:
        if sim_status != "running":
            if st.button("▶  Run Simulation", use_container_width=True, disabled=(sim_status == "running")):
                st.session_state.sim_status = "running"
                with st.spinner("Running simulation…"):
                    _run_simulation()
                st.rerun()
        else:
            st.button("⏳ Running…", disabled=True, use_container_width=True)
    with c_first:
        if st.button("⏮", disabled=not pos_hist, use_container_width=True):
            st.session_state.current_step = 0
            st.rerun()
    with c_prev:
        if st.button("◀", disabled=(not pos_hist or cur == 0), use_container_width=True):
            st.session_state.current_step = max(0, cur - 1)
            st.rerun()
    with c_next:
        if st.button("▶", disabled=(not pos_hist or cur >= total_steps - 1), use_container_width=True):
            st.session_state.current_step = min(total_steps - 1, cur + 1)
            st.rerun()
    with c_last:
        if st.button("⏭", disabled=not pos_hist, use_container_width=True):
            st.session_state.current_step = max(0, total_steps - 1)
            st.rerun()
    with c_reset:
        if st.button("↺  Reset", use_container_width=True):
            st.session_state.update({
                "position_history": [],
                "speech_history": [],
                "current_step": 0,
                "sim_status": "idle",
                "results": None,
            })
            st.rerun()

    # Step slider
    if pos_hist and total_steps > 1:
        new_step = st.slider(
            "Step",
            0, total_steps - 1, cur,
            label_visibility="collapsed",
            key="step_slider",
        )
        if new_step != cur:
            st.session_state.current_step = new_step
            st.rerun()

    # Messages
    st.markdown('<div class="sec-title">💬 Messages — Step {}</div>'.format(cur), unsafe_allow_html=True)
    speech_at_step = spk_hist[cur] if spk_hist and cur < len(spk_hist) else {}
    messages = [(n, m) for n, m in speech_at_step.items() if m]

    if messages:
        color_map = {a["name"]: AGENT_COLORS[i % len(AGENT_COLORS)] for i, a in enumerate(agents_cfg)}
        html_msgs = "".join(
            f'<div class="msg-entry">'
            f'<span style="color:{color_map.get(n, "#4fc3f7")}; font-weight:700;">{n}:</span> {m}'
            f'</div>'
            for n, m in messages
        )
        st.markdown(f'<div class="msg-panel">{html_msgs}</div>', unsafe_allow_html=True)
    else:
        st.markdown(
            '<div class="msg-panel" style="color:#4a4a6a;">(no messages this step)</div>',
            unsafe_allow_html=True,
        )

with col_panel:
    # ── Key metrics ───────────────────────────────────────────────────────
    st.markdown('<div class="sec-title" style="margin-top:0;">📊 Metrics</div>', unsafe_allow_html=True)

    total_agents = len(agents_cfg)
    steps_left = deadline - cur

    surv_cls = "ok" if survival_pct == 100 else "bad" if survival_pct < 50 and pos_hist else "mc-value"
    active_cls = "bad" if active_n > 0 and steps_left <= 3 else "mc-value"

    st.markdown(
        f"""
<div class="metric-card">
    <div class="mc-label">Active Agents</div>
    <div class="mc-value {active_cls}">{active_n}</div>
</div>
<div class="metric-card">
    <div class="mc-label">Exited</div>
    <div class="mc-value ok">{exited_n}</div>
</div>
<div class="metric-card">
    <div class="mc-label">Survival Rate</div>
    <div class="mc-value {surv_cls}">{survival_pct:.0f}%</div>
</div>
<div class="metric-card">
    <div class="mc-label">Steps Elapsed</div>
    <div class="mc-value">{cur} / {deadline}</div>
</div>
<div class="metric-card">
    <div class="mc-label">Grid Size</div>
    <div class="mc-value" style="font-size:1.1rem;">{env['width']}×{env['height']}</div>
</div>
""",
        unsafe_allow_html=True,
    )

    # ── Agent status list ─────────────────────────────────────────────────
    st.markdown('<div class="sec-title">👥 Agent Status</div>', unsafe_allow_html=True)

    frame = pos_hist[cur] if pos_hist and cur < total_steps else {}
    for i, agent in enumerate(agents_cfg):
        name = agent["name"]
        color = AGENT_COLORS[i % len(AGENT_COLORS)]

        if frame:
            raw = frame.get(name)
            if raw == "exited":
                dot = "✓"
                dot_color = "#2ecc71"
                pos_text = "EXITED"
            elif raw:
                dot = "●"
                dot_color = color
                pos_text = f"({raw[0]},{raw[1]})"
            else:
                dot = "?"
                dot_color = "#7f8c8d"
                pos_text = "unknown"
        else:
            dot = "●"
            dot_color = color
            pos_text = f"({agent['position'][0]},{agent['position'][1]})"

        st.markdown(
            f"""
<div class="agent-row" style="border-left:3px solid {color};">
    <span style="color:{dot_color}; font-size:0.75rem;">{dot}</span>
    <span class="agent-name">{name}</span>
    <span class="agent-pos">{pos_text}</span>
</div>
""",
            unsafe_allow_html=True,
        )

    # ── Benchmark results ─────────────────────────────────────────────────
    if sim_status == "complete" and pos_hist:
        if st.button("📈 Run Benchmarks", use_container_width=True):
            with st.spinner("Computing metrics…"):
                from benchmarks.results import build_results

                start_positions = {a["name"]: tuple(a["position"]) for a in agents_cfg}
                results = build_results(
                    position_history=pos_hist,
                    door_position=tuple(env["door"]),
                    grid_size=(env["width"], env["height"]),
                    deadline=deadline,
                    agent_start_positions=start_positions,
                )
                st.session_state.results = results

        if st.session_state.results:
            ov = st.session_state.results.get("simulationOverview", {})
            mean_t = ov.get("meanEvacuationTime")
            last_t = ov.get("lastEvacuationTime")
            st.markdown('<div class="sec-title">📈 Benchmark</div>', unsafe_allow_html=True)
            st.markdown(
                f"""
<div class="metric-card">
    <div class="mc-label">Mean Evac. Time</div>
    <div class="mc-value" style="font-size:1.1rem;">{f"{mean_t:.1f}" if mean_t else "N/A"}</div>
</div>
<div class="metric-card">
    <div class="mc-label">Last Evac. Time</div>
    <div class="mc-value" style="font-size:1.1rem;">{f"{last_t:.1f}" if last_t else "N/A"}</div>
</div>
""",
                unsafe_allow_html=True,
            )

    # ── Export ────────────────────────────────────────────────────────────
    if pos_hist:
        st.markdown('<div class="sec-title">⬇ Export</div>', unsafe_allow_html=True)
        export = {
            "config": cfg,
            "position_history": [
                {k: list(v) if isinstance(v, tuple) else v for k, v in f.items()}
                for f in pos_hist
            ],
            "speech_history": spk_hist,
        }
        if st.session_state.results:
            export["benchmark"] = st.session_state.results

        st.download_button(
            "Export JSON",
            data=json.dumps(export, indent=2),
            file_name="simulation_results.json",
            mime="application/json",
            use_container_width=True,
        )
