from __future__ import annotations

from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import yaml

from simulation.model import EvaluationModel

load_dotenv()


class EnvironmentConfig(BaseModel):
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    deadline: int = Field(..., ge=1)
    llm_model: str
    door: list[int] = Field(..., min_length=2, max_length=2)
    obstacles: list[list[int]] = Field(default_factory=list)


class AgentConfig(BaseModel):
    name: str
    role: str
    personality: str
    position: list[int] = Field(..., min_length=2, max_length=2)


class SimulationConfig(BaseModel):
    environment: EnvironmentConfig
    agents: list[AgentConfig] = Field(..., min_length=1)


class SimulationResponse(BaseModel):
    steps_run: int
    total_agents: int
    exited_agents: int
    remaining_agents: int
    position_history: list[dict[str, list[int] | str]]
    speech_history: list[dict[str, str | None]]


def _sign(value: int) -> int:
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _serialize_frame(frame: dict[str, Any]) -> dict[str, list[int] | str]:
    serialized: dict[str, list[int] | str] = {}
    for name, value in frame.items():
        if value == "exited":
            serialized[name] = "exited"
        elif isinstance(value, tuple):
            serialized[name] = [value[0], value[1]]
        elif isinstance(value, list) and len(value) == 2:
            serialized[name] = [value[0], value[1]]
        else:
            raise ValueError(f"Unsupported frame value for '{name}': {value!r}")
    return serialized


def _run_fallback_simulation(cfg: SimulationConfig) -> SimulationResponse:
    """Deterministic grid fallback used when remote LLM calls fail."""
    env = cfg.environment
    width = env.width
    height = env.height
    deadline = env.deadline
    door = (env.door[0], env.door[1])
    obstacles = {tuple(o) for o in env.obstacles}

    names = [a.name for a in cfg.agents]
    active: dict[str, tuple[int, int]] = {
        a.name: (a.position[0], a.position[1]) for a in cfg.agents
    }

    position_history: list[dict[str, list[int] | str]] = []
    speech_history: list[dict[str, str | None]] = []
    exited_agents: set[str] = set()

    for _ in range(deadline):
        occupied = set(active.values())
        updated: dict[str, tuple[int, int]] = {}

        for name in names:
            if name in exited_agents or name not in active:
                continue

            x, y = active[name]
            if (x, y) == door:
                exited_agents.add(name)
                occupied.discard((x, y))
                continue

            occupied.discard((x, y))

            dx = _sign(door[0] - x)
            dy = _sign(door[1] - y)
            candidates = [
                (x + dx, y + dy),
                (x + dx, y),
                (x, y + dy),
                (x + dx, y - dy),
                (x - dx, y + dy),
                (x - dx, y),
                (x, y - dy),
                (x, y),
            ]

            chosen = (x, y)
            for nx, ny in candidates:
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                if (nx, ny) in obstacles:
                    continue
                if (nx, ny) in occupied:
                    continue
                chosen = (nx, ny)
                break

            if chosen == door:
                exited_agents.add(name)
            else:
                updated[name] = chosen
                occupied.add(chosen)

        active = updated

        pos_frame: dict[str, list[int] | str] = {}
        speech_frame: dict[str, str | None] = {}
        for name in names:
            if name in exited_agents:
                pos_frame[name] = "exited"
            elif name in active:
                px, py = active[name]
                pos_frame[name] = [px, py]
            else:
                # Agent blocked but still in sim should remain visible at last known position.
                start = next(a.position for a in cfg.agents if a.name == name)
                pos_frame[name] = [start[0], start[1]]
            speech_frame[name] = None

        position_history.append(pos_frame)
        speech_history.append(speech_frame)

        if len(exited_agents) == len(names):
            break

    total_agents = len(names)
    return SimulationResponse(
        steps_run=len(position_history),
        total_agents=total_agents,
        exited_agents=len(exited_agents),
        remaining_agents=max(total_agents - len(exited_agents), 0),
        position_history=position_history,
        speech_history=speech_history,
    )


def run_simulation(cfg: SimulationConfig) -> SimulationResponse:
    env = cfg.environment
    try:
        model = EvaluationModel(
            width=env.width,
            height=env.height,
            deadline=env.deadline,
            door_position=(env.door[0], env.door[1]),
            agent_configs=[a.model_dump() for a in cfg.agents],
            llm_model=env.llm_model,
            obstacles=env.obstacles,
        )

        while model.running:
            model.step()
    except Exception:
        return _run_fallback_simulation(cfg)

    position_history = [_serialize_frame(f) for f in model.position_history]
    speech_history = [
        {name: msg for name, msg in frame.items()} for frame in model.speech_history
    ]

    final_frame = position_history[-1] if position_history else {}
    exited_agents = sum(1 for pos in final_frame.values() if pos == "exited")
    total_agents = len(cfg.agents)

    return SimulationResponse(
        steps_run=model.current_step,
        total_agents=total_agents,
        exited_agents=exited_agents,
        remaining_agents=max(total_agents - exited_agents, 0),
        position_history=position_history,
        speech_history=speech_history,
    )


def load_default_config() -> SimulationConfig:
    cfg_path = Path(__file__).parent / "configs" / "agents.yaml"
    try:
        with cfg_path.open("r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load default config: {exc}")
    return SimulationConfig.model_validate(cfg)


app = FastAPI(title="Agentic Hackathon API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config/default", response_model=SimulationConfig)
def get_default_config() -> SimulationConfig:
    return load_default_config()


@app.post("/api/simulate", response_model=SimulationResponse)
def simulate(cfg: SimulationConfig) -> SimulationResponse:
    try:
        return run_simulation(cfg)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Simulation failed: {exc}")


@app.post("/api/simulate/default", response_model=SimulationResponse)
def simulate_default() -> SimulationResponse:
    return simulate(load_default_config())


_DIST_DIR = Path(__file__).parent / "ui" / "dist"
if _DIST_DIR.exists():
    assets_dir = _DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    def serve_root() -> FileResponse:
        return FileResponse(_DIST_DIR / "index.html")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str) -> FileResponse:
        candidate = _DIST_DIR / full_path
        if candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST_DIR / "index.html")
