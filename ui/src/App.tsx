import React, { useState, useEffect, useMemo, useRef } from 'react';
import { VenueLayout, SimConfig, SimFrame, Metrics, AgentState } from './models/types';
import VenueEditor from './ui/VenueEditor';
import SimCanvas from './ui/SimCanvas';
import MetricsPanel from './ui/MetricsPanel';
import { getBackendHealth, runDefaultBackendSimulation, getDefaultBackendConfig, BackendSimSummary } from './utils/backend';

// ─── Sample venue ─────────────────────────────────────────────────────────────
const SAMPLE_VENUE: VenueLayout = {
  width: 10,
  height: 10,
  walls: [],
  entrances: [],
  exits: [{ id: 'exit-main', x: 9.5, y: 5.5, width: 1, capacity: 100 }],
  attractors: [],
};

const DEFAULT_CONFIG: SimConfig = {
  N: 500,
  arrivalMode: 'linear',
  arrivalDuration: 15,
  speedMin: 0.8,
  speedMean: 1.4,
  speedMax: 2.0,
  personalSpace: 0.8,
  avoidanceStrength: 2.0,
  queueEnabled: true,
  evacuationEnabled: false,
  evacuationTime: 20,
  panicSpeedMultiplier: 1.5,
  densityWarning: 2.0,
  densityDanger: 4.0,
  cellSize: 1,
  egresTimeLimitMin: 8,
  warningTimeLimitPct: 5,
  sweepStep: 200,
  sweepMinN: 200,
  sweepMaxN: 2000,
};

const EMPTY_METRICS: Metrics = {
  simTime: 0, activeAgents: 0, exitedAgents: 0,
  peakDensity: 0, currentMaxDensity: 0,
  timeAboveWarning: 0, timeAboveDanger: 0,
  avgEgressTime: 0, p95EgressTime: 0,
  queueLengths: {}, maxQueueLengths: {},
};

const EMPTY_FRAME: SimFrame = {
  agents: [], densityGrid: [], gridCols: 0, gridRows: 0,
  metrics: EMPTY_METRICS, simTime: 0, isRunning: false, isEvacuating: false,
};

type Tab = 'editor' | 'simulation' | 'estimator' | 'scenarios';
type BackendStatus = 'checking' | 'online' | 'offline';

function mapBackendVenue(width: number, height: number, door: [number, number], obstacles: [number, number][]): VenueLayout {
  return {
    width,
    height,
    walls: obstacles.map((o, i) => ({ id: `obs-${i}`, rect: { x: o[0], y: o[1], w: 1, h: 1 } })),
    entrances: [],
    exits: [{ id: 'exit-main', x: door[0] + 0.5, y: door[1] + 0.5, width: 1, capacity: 100 }],
    attractors: [],
  };
}

function buildFrameFromBackend(
  run: BackendSimSummary,
  stepIndex: number,
  isRunning: boolean,
): SimFrame {
  const boundedStep = Math.max(0, Math.min(stepIndex, run.position_history.length - 1));
  const framePositions = run.position_history[boundedStep] ?? {};
  const agentNames = Object.keys(run.position_history[0] ?? framePositions);

  let activeAgents = 0;
  const agents = agentNames.flatMap((name, idx) => {
    const pos = framePositions[name];
    if (!pos || pos === 'exited') return [];
    activeAgents += 1;
    return [{
      id: idx,
      x: pos[0] + 0.5,
      y: pos[1] + 0.5,
      vx: 0,
      vy: 0,
      radius: 0.28,
      state: 'seeking_exit' as AgentState,
    }];
  });

  const exitedAgents = run.total_agents - activeAgents;

  return {
    agents,
    densityGrid: [],
    gridCols: 0,
    gridRows: 0,
    metrics: {
      ...EMPTY_METRICS,
      simTime: boundedStep,
      activeAgents,
      exitedAgents,
    },
    simTime: boundedStep,
    isRunning,
    isEvacuating: false,
  };
}

export default function App() {
  const [tab, setTab] = useState<Tab>('simulation');
  const [layout, setLayout] = useState<VenueLayout>(SAMPLE_VENUE);
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [frame, setFrame] = useState<SimFrame>(EMPTY_FRAME);
  const [showHeatmap, setHeatmap] = useState(true);
  const [showAgents, setAgents] = useState(true);
  const [showBottlenecks, setBottlenecks] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [backendSummary, setBackendSummary] = useState<BackendSimSummary | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const [playbackStep, setPlaybackStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getBackendHealth()
      .then(() => setBackendStatus('online'))
      .catch(() => setBackendStatus('offline'));
    getDefaultBackendConfig()
      .then((cfg) => {
        setLayout(mapBackendVenue(cfg.environment.width, cfg.environment.height, cfg.environment.door, cfg.environment.obstacles));
      })
      .catch(() => {
        // Keep sample venue if backend config is unavailable.
      });
  }, []);

  useEffect(() => {
    if (!backendSummary) return;
    setFrame(buildFrameFromBackend(backendSummary, playbackStep, playing));
  }, [backendSummary, playbackStep, playing]);

  useEffect(() => {
    if (!playing || !backendSummary) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setPlaybackStep((prev) => {
        const next = prev + 1;
        if (next >= backendSummary.position_history.length) {
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, 450);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, backendSummary]);

  const handleRunBackendDefault = async () => {
    try {
      setBackendLoading(true);
      setBackendError(null);
      const [cfg, summary] = await Promise.all([
        getDefaultBackendConfig(),
        runDefaultBackendSimulation(),
      ]);
      setLayout(mapBackendVenue(cfg.environment.width, cfg.environment.height, cfg.environment.door, cfg.environment.obstacles));
      setBackendSummary(summary);
      setPlaybackStep(0);
      setPlaying(summary.position_history.length > 0);
      setBackendStatus('online');
    } catch (err) {
      setBackendStatus('offline');
      setBackendSummary(null);
      setBackendError(err instanceof Error ? err.message : 'Backend simulation failed.');
    } finally {
      setBackendLoading(false);
    }
  };

  const totalFrames = backendSummary?.position_history.length ?? 0;
  const canStep = useMemo(() => totalFrames > 0 && playbackStep < totalFrames - 1, [totalFrames, playbackStep]);
  const canBack = useMemo(() => totalFrames > 0 && playbackStep > 0, [totalFrames, playbackStep]);

  return (
    <div style={{
      minHeight: '100vh', background: '#0f1117', color: '#e5e7eb',
      fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        background: '#1e2433', borderBottom: '1px solid #374151',
        padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#60a5fa', letterSpacing: '-0.02em' }}>
          🏟 CrowdFlow Simulator
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {(['simulation', 'editor'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: tab === t ? '#1d4ed8' : 'transparent',
              color: tab === t ? '#fff' : '#9ca3af',
              border: tab === t ? '1px solid #3b82f6' : '1px solid transparent',
            }}>
              {t === 'editor' ? '✏ Venue Visuals' : '▶ Backend Simulation'}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            title="Python backend API status"
            style={{
              fontSize: 11,
              color: backendStatus === 'online' ? '#86efac' : backendStatus === 'offline' ? '#fca5a5' : '#fcd34d',
            }}
          >
            Backend: {backendStatus === 'checking' ? 'checking...' : backendStatus}
          </span>
          <button
            onClick={handleRunBackendDefault}
            disabled={backendLoading}
            style={headerBtn('#0ea5e9')}
            title="Run Python backend simulation using configs/agents.yaml"
          >
            {backendLoading ? 'Running backend...' : 'Run Backend Sim'}
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: canvas area */}
        <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tab === 'editor' && (
            <VenueEditor layout={layout} onChange={setLayout} />
          )}
          {tab === 'simulation' && (
            <>
              {/* Overlay toggles */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#9ca3af' }}>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showHeatmap} onChange={e => setHeatmap(e.target.checked)} />
                  Heatmap
                </label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showAgents} onChange={e => setAgents(e.target.checked)} />
                  Agents
                </label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showBottlenecks} onChange={e => setBottlenecks(e.target.checked)} />
                  Bottlenecks
                </label>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4b5563' }}>
                  step {playbackStep + 1} / {Math.max(totalFrames, 1)}
                </span>
              </div>
              <SimCanvas
                frame={frame}
                layout={layout}
                config={config}
                showHeatmap={showHeatmap}
                showAgents={showAgents}
                showBottlenecks={showBottlenecks}
              />
            </>
          )}
        </div>

        {/* Right: controls + metrics */}
        <div style={{
          width: 300, background: '#1e2433', borderLeft: '1px solid #374151',
          padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {(backendSummary || backendError) && (
            <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', marginBottom: 8 }}>
                Python Backend
              </div>
              {backendSummary && (
                <div style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.5 }}>
                  Steps: <b>{backendSummary.steps_run}</b><br />
                  Exited: <b>{backendSummary.exited_agents}</b> / <b>{backendSummary.total_agents}</b><br />
                  Remaining: <b>{backendSummary.remaining_agents}</b>
                </div>
              )}
              {backendError && (
                <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.4 }}>
                  {backendError}
                </div>
              )}
            </div>
          )}

          {/* Metrics always visible */}
          <MetricsPanel
            metrics={frame.metrics}
            config={config}
            layout={layout}
            simTime={frame.simTime}
            isEvacuating={frame.isEvacuating}
          />

          <div style={{ borderTop: '1px solid #374151', paddingTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                onClick={() => setPlaying((v) => !v)}
                disabled={!backendSummary}
                style={headerBtn(playing ? '#f59e0b' : '#22c55e')}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                onClick={() => {
                  if (!canStep) return;
                  setPlaybackStep((s) => s + 1);
                }}
                disabled={!canStep}
                style={headerBtn('#60a5fa')}
              >
                Step
              </button>
              <button
                onClick={() => {
                  if (!canBack) return;
                  setPlaybackStep((s) => s - 1);
                }}
                disabled={!canBack}
                style={headerBtn('#6b7280')}
              >
                Back
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setPlaybackStep(0);
                }}
                disabled={!backendSummary}
                style={headerBtn('#ef4444')}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function headerBtn(color: string): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
    background: `${color}33`, color: '#d1d5db',
    border: `1px solid ${color}`, cursor: 'pointer',
  };
}
