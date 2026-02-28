import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VenueLayout, SimConfig, SimFrame, Metrics, Scenario, SweepResult } from './models/types';
import { SimEngine } from './sim/engine';
import VenueEditor from './ui/VenueEditor';
import SimCanvas from './ui/SimCanvas';
import SimControls from './ui/SimControls';
import MetricsPanel from './ui/MetricsPanel';
import SafetyEstimator from './ui/SafetyEstimator';
import ScenarioManager from './ui/ScenarioManager';
import { exportResultsJSON, exportResultsCSV, exportVenueJSON, loadVenueJSON } from './utils/export';

// ─── Sample venue ─────────────────────────────────────────────────────────────
const SAMPLE_VENUE: VenueLayout = {
  width: 60,
  height: 40,
  walls: [
    { id: 'w1', rect: { x: 10, y: 0,  w: 2, h: 15 } },   // left divider
    { id: 'w2', rect: { x: 10, y: 25, w: 2, h: 15 } },
    { id: 'w3', rect: { x: 48, y: 0,  w: 2, h: 15 } },   // right divider
    { id: 'w4', rect: { x: 48, y: 25, w: 2, h: 15 } },
    { id: 'w5', rect: { x: 18, y: 12, w: 24, h: 1.5 } }, // inner barrier
    { id: 'w6', rect: { x: 20, y: 30, w: 5,  h: 5 } },   // obstacle 1
    { id: 'w7', rect: { x: 35, y: 30, w: 5,  h: 5 } },   // obstacle 2
  ],
  entrances: [
    { id: 'en1', x: 5,  y: 0.5,  width: 4 },
    { id: 'en2', x: 55, y: 0.5,  width: 4 },
  ],
  exits: [
    { id: 'ex1', x: 5,  y: 39.5, width: 4, capacity: 3 },
    { id: 'ex2', x: 30, y: 39.5, width: 6, capacity: 4 },
    { id: 'ex3', x: 55, y: 39.5, width: 4, capacity: 3 },
  ],
  attractors: [
    { id: 'att1', x: 30, y: 8,  radius: 4, weight: 1.0, label: 'Stage',  serviceTime: 120, queueEnabled: false, queueCapacity: 100 },
    { id: 'att2', x: 8,  y: 22, radius: 3, weight: 0.6, label: 'Bar',    serviceTime: 60,  queueEnabled: true,  queueCapacity: 15 },
    { id: 'att3', x: 52, y: 22, radius: 3, weight: 0.6, label: 'Bar',    serviceTime: 60,  queueEnabled: true,  queueCapacity: 15 },
    { id: 'att4', x: 8,  y: 35, radius: 2, weight: 0.3, label: 'WC',     serviceTime: 120, queueEnabled: true,  queueCapacity: 8  },
    { id: 'att5', x: 52, y: 35, radius: 2, weight: 0.3, label: 'WC',     serviceTime: 120, queueEnabled: true,  queueCapacity: 8  },
  ],
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

export default function App() {
  const [tab, setTab]           = useState<Tab>('simulation');
  const [layout, setLayout]     = useState<VenueLayout>(SAMPLE_VENUE);
  const [config, setConfig]     = useState<SimConfig>(DEFAULT_CONFIG);
  const [frame, setFrame]       = useState<SimFrame>(EMPTY_FRAME);
  const [showHeatmap, setHeatmap]         = useState(true);
  const [showAgents, setAgents]           = useState(true);
  const [showBottlenecks, setBottlenecks] = useState(true);
  const [fireMode, setFireMode]           = useState(false);
  const [blockedExits, setBlockedExits]   = useState<Set<string>>(new Set());
  const [scenarios, setScenarios]         = useState<Scenario[]>([]);

  const engineRef   = useRef<SimEngine | null>(null);
  const rafRef      = useRef<number>(0);
  const lastTime    = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const alarmRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const startAlarm = useCallback(() => {
    if (audioCtxRef.current) return; // already ringing
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    let phase = 0;
    const beep = () => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = phase ? 960 : 820;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      phase ^= 1;
    };
    beep();
    alarmRef.current = setInterval(beep, 500);
  }, []);

  const stopAlarm = useCallback(() => {
    if (alarmRef.current) { clearInterval(alarmRef.current); alarmRef.current = null; }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  // Init engine
  useEffect(() => {
    const eng = new SimEngine(layout, config);
    eng.reset();
    engineRef.current = eng;
    setFrame(eng.getFrame());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop alarm when fire is fully extinguished
  useEffect(() => {
    const hasFire = frame.fireGrid?.some(row => row.includes(true));
    if (!hasFire && audioCtxRef.current) stopAlarm();
  }, [frame.fireGrid, stopAlarm]);

  // RAF loop
  useEffect(() => {
    const loop = (ts: number) => {
      const dt = lastTime.current ? Math.min((ts - lastTime.current) / 1000, 0.05) : 0;
      lastTime.current = ts;

      const eng = engineRef.current;
      if (eng?.running) {
        eng.tick(dt);
        setFrame(eng.getFrame());
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const syncEngineConfig = useCallback((cfg: SimConfig) => {
    setConfig(cfg);
    engineRef.current?.updateConfig(cfg);
  }, []);

  const syncLayout = useCallback((l: VenueLayout) => {
    setLayout(l);
    engineRef.current?.updateLayout(l);
  }, []);

  const handleRun = () => {
    if (!engineRef.current) return;
    engineRef.current.start();
    setFrame(engineRef.current.getFrame());
  };

  const handlePause = () => {
    engineRef.current?.pause();
    setFrame(engineRef.current!.getFrame());
  };

  const handleStep = () => {
    if (!engineRef.current) return;
    engineRef.current.tick(0.1);
    setFrame(engineRef.current.getFrame());
  };

  const handleFireClick = useCallback((wx: number, wy: number) => {
    engineRef.current?.startFire(wx, wy);
    startAlarm();
  }, [startAlarm]);

  const toggleExit = useCallback((id: string) => {
    setBlockedExits(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      engineRef.current?.setBlockedExits(next);
      return next;
    });
  }, []);

  // ── Scenario handlers ───────────────────────────────────────────────────────
  const handleSaveScenario = useCallback((name: string) => {
    const newScenario: Scenario = {
      id: `sc-${Date.now()}`,
      name,
      layout: layout,
      sweepResults: [],
      ranAt: null,
    };
    setScenarios(prev => [...prev, newScenario]);
  }, [layout]);

  const handleLoadScenario = useCallback((id: string) => {
    const sc = scenarios.find(s => s.id === id);
    if (!sc) return;
    syncLayout(sc.layout);
    setTab('simulation');
  }, [scenarios, syncLayout]);

  const handleDeleteScenario = useCallback((id: string) => {
    setScenarios(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleUpdateScenarioResults = useCallback((id: string, results: SweepResult[]) => {
    setScenarios(prev => prev.map(s =>
      s.id === id ? { ...s, sweepResults: results, ranAt: new Date().toISOString() } : s
    ));
  }, []);

  const handleReset = () => {
    if (!engineRef.current) return;
    stopAlarm();
    setBlockedExits(new Set());
    engineRef.current.pause();
    engineRef.current.reset();
    engineRef.current.start();
    lastTime.current = 0;
    setFrame(engineRef.current.getFrame());
  };

  const handleLoadSample = () => {
    syncLayout(SAMPLE_VENUE);
    if (engineRef.current) {
      engineRef.current.updateLayout(SAMPLE_VENUE);
      engineRef.current.reset();
      setFrame(engineRef.current.getFrame());
    }
  };

  const handleLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const loaded = await loadVenueJSON(file);
      syncLayout(loaded);
    } catch { alert('Failed to load venue file.'); }
    e.target.value = '';
  };

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
          {(['editor', 'simulation', 'estimator', 'scenarios'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: tab === t ? '#1d4ed8' : 'transparent',
              color: tab === t ? '#fff' : '#9ca3af',
              border: tab === t ? '1px solid #3b82f6' : '1px solid transparent',
            }}>
              {t === 'editor' ? '✏ Venue Editor'
                : t === 'simulation' ? '▶ Simulation'
                : t === 'estimator' ? '🔍 Safety Estimator'
                : <>📐 Scenarios {scenarios.length > 0 && <span style={{ background: '#3b82f6', color: '#fff', borderRadius: 8, padding: '0 5px', fontSize: 10 }}>{scenarios.length}</span>}</>}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={handleLoadSample} style={headerBtn('#7c3aed')}>Load Sample</button>
          <label style={{ ...headerBtn('#374151') as React.CSSProperties, cursor: 'pointer' }}>
            Upload Venue
            <input type="file" accept=".json" onChange={handleLoadFile} style={{ display: 'none' }} />
          </label>
          <button onClick={() => exportVenueJSON(layout)} style={headerBtn('#374151')}>Save Venue</button>
          <button onClick={() => exportResultsJSON(frame.metrics, config, layout, [])} style={headerBtn('#374151')}>Export JSON</button>
          <button onClick={() => exportResultsCSV(frame.metrics, [])} style={headerBtn('#374151')}>Export CSV</button>
        </div>
      </header>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: canvas area */}
        <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tab === 'editor' && (
            <VenueEditor layout={layout} onChange={syncLayout} />
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
                <button onClick={() => setFireMode(f => !f)} style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  background: fireMode ? '#7f1d1d' : 'transparent',
                  color: fireMode ? '#fca5a5' : '#9ca3af',
                  border: `1px solid ${fireMode ? '#ef4444' : '#4b5563'}`,
                }}>
                  🔥 {fireMode ? 'Place fire' : 'Fire mode'}
                </button>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4b5563' }}>
                  {frame.agents.length} agents | T={Math.floor(frame.simTime / 60)}:{Math.floor(frame.simTime % 60).toString().padStart(2,'0')}
                </span>
              </div>
              {/* Exit scenario toggles */}
              {layout.exits.length > 0 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>Exits:</span>
                  {layout.exits.map(ex => {
                    const blocked = blockedExits.has(ex.id);
                    return (
                      <button key={ex.id} onClick={() => toggleExit(ex.id)} title={blocked ? 'Click to re-open exit' : 'Click to block exit'} style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                        background: blocked ? '#7f1d1d' : '#05351c',
                        color: blocked ? '#fca5a5' : '#86efac',
                        border: `1px solid ${blocked ? '#ef4444' : '#22c55e'}`,
                      }}>
                        {ex.id} {blocked ? '✗ BLOCKED' : '✓ OPEN'}
                      </button>
                    );
                  })}
                  {blockedExits.size > 0 && (
                    <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 4 }}>
                      ⚠ {blockedExits.size} exit{blockedExits.size > 1 ? 's' : ''} blocked — agents re-routing
                    </span>
                  )}
                </div>
              )}
              <SimCanvas
                frame={frame}
                layout={layout}
                config={config}
                showHeatmap={showHeatmap}
                showAgents={showAgents}
                showBottlenecks={showBottlenecks}
                fireMode={fireMode}
                onFireClick={handleFireClick}
              />
            </>
          )}
          {tab === 'estimator' && (
            <div style={{ maxWidth: 560 }}>
              <SafetyEstimator config={config} layout={layout} />
            </div>
          )}
          {tab === 'scenarios' && (
            <ScenarioManager
              scenarios={scenarios}
              currentLayout={layout}
              config={config}
              onSave={handleSaveScenario}
              onLoad={handleLoadScenario}
              onDelete={handleDeleteScenario}
              onUpdateResults={handleUpdateScenarioResults}
            />
          )}
        </div>

        {/* Right: controls + metrics */}
        <div style={{
          width: 300, background: '#1e2433', borderLeft: '1px solid #374151',
          padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {/* Metrics always visible */}
          <MetricsPanel
            metrics={frame.metrics}
            config={config}
            layout={layout}
            simTime={frame.simTime}
            isEvacuating={frame.isEvacuating}
          />

          <div style={{ borderTop: '1px solid #374151', paddingTop: 12 }}>
            <SimControls
              config={config}
              onChange={syncEngineConfig}
              onRun={handleRun}
              onPause={handlePause}
              onStep={handleStep}
              onReset={handleReset}
              isRunning={frame.isRunning}
            />
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
