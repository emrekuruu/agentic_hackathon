import React from 'react';
import { SimConfig, ArrivalMode } from '../models/types';

interface Props {
  config: SimConfig;
  onChange: (cfg: SimConfig) => void;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  isRunning: boolean;
}

function Tip({ text }: { text: string }) {
  return (
    <span title={text} style={{ cursor: 'help', color: '#6b7280', fontSize: 12, marginLeft: 4 }}>ⓘ</span>
  );
}

function Row({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 28 }}>
      <label style={{ fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        {label}<Tip text={tip} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{children}</div>
    </div>
  );
}

const inp: React.CSSProperties = {
  background: '#1e1e2e', color: '#e5e7eb', border: '1px solid #374151',
  borderRadius: 4, padding: '2px 6px', fontSize: 12, width: 60,
};

export default function SimControls({ config: c, onChange, onRun, onPause, onStep, onReset, isRunning }: Props) {
  const set = <K extends keyof SimConfig>(key: K, val: SimConfig[K]) =>
    onChange({ ...c, [key]: val });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Run controls */}
      <div style={{ display: 'flex', gap: 6 }}>
        {!isRunning
          ? <button onClick={onRun}   style={btnStyle('#22c55e')}>▶ Run</button>
          : <button onClick={onPause} style={btnStyle('#f59e0b')}>⏸ Pause</button>
        }
        <button onClick={onStep}  style={btnStyle('#60a5fa')}>⏭ Step</button>
        <button onClick={onReset} style={btnStyle('#ef4444')}>↺ Reset</button>
      </div>

      <Section title="Participants">
        <Row label="Total N" tip="Number of participants to simulate">
          <input type="range" min={50} max={5000} step={50} value={c.N}
            onChange={e => set('N', +e.target.value)} style={{ width: 110 }} />
          <input type="number" min={50} max={5000} value={c.N}
            onChange={e => set('N', +e.target.value)} style={{ ...inp, width: 55 }} />
        </Row>
      </Section>

      <Section title="Arrival Curve">
        <Row label="Mode" tip="How participants arrive over time">
          <select value={c.arrivalMode} onChange={e => set('arrivalMode', e.target.value as ArrivalMode)}
            style={{ ...inp, width: 100 }}>
            <option value="burst">Burst</option>
            <option value="linear">Linear</option>
            <option value="gaussian">Gaussian peak</option>
          </select>
        </Row>
        <Row label="Duration (min)" tip="Time window over which participants arrive">
          <input type="range" min={1} max={60} value={c.arrivalDuration}
            onChange={e => set('arrivalDuration', +e.target.value)} style={{ width: 90 }} />
          <input type="number" value={c.arrivalDuration}
            onChange={e => set('arrivalDuration', +e.target.value)} style={inp} />
        </Row>
      </Section>

      <Section title="Walking Speed (m/s)">
        <Row label="Min" tip="Slowest walking speed">
          <input type="number" min={0.3} max={1} step={0.1} value={c.speedMin}
            onChange={e => set('speedMin', +e.target.value)} style={inp} />
        </Row>
        <Row label="Mean" tip="Average walking speed (about 1.4 m/s = 5 km/h)">
          <input type="number" min={0.5} max={2} step={0.1} value={c.speedMean}
            onChange={e => set('speedMean', +e.target.value)} style={inp} />
        </Row>
        <Row label="Max" tip="Fastest walking speed">
          <input type="number" min={1} max={3} step={0.1} value={c.speedMax}
            onChange={e => set('speedMax', +e.target.value)} style={inp} />
        </Row>
      </Section>

      <Section title="Crowd Behaviour">
        <Row label="Personal space (m)" tip="Desired minimum distance between agents (repulsion radius)">
          <input type="range" min={0.3} max={2} step={0.1} value={c.personalSpace}
            onChange={e => set('personalSpace', +e.target.value)} style={{ width: 90 }} />
          <input type="number" min={0.3} max={2} step={0.1} value={c.personalSpace}
            onChange={e => set('personalSpace', +e.target.value)} style={inp} />
        </Row>
        <Row label="Avoidance strength" tip="How strongly agents push each other apart (0=none, 5=strong)">
          <input type="range" min={0} max={5} step={0.5} value={c.avoidanceStrength}
            onChange={e => set('avoidanceStrength', +e.target.value)} style={{ width: 90 }} />
          <input type="number" min={0} max={5} step={0.5} value={c.avoidanceStrength}
            onChange={e => set('avoidanceStrength', +e.target.value)} style={inp} />
        </Row>
      </Section>

      <Section title="Queue Behaviour">
        <Row label="Enable queuing" tip="Agents wait in line at attractors when enabled">
          <input type="checkbox" checked={c.queueEnabled}
            onChange={e => set('queueEnabled', e.target.checked)} />
        </Row>
      </Section>

      <Section title="Evacuation">
        <Row label="Enable evacuation" tip="Trigger all agents to move toward exits at a given time">
          <input type="checkbox" checked={c.evacuationEnabled}
            onChange={e => set('evacuationEnabled', e.target.checked)} />
        </Row>
        {c.evacuationEnabled && <>
          <Row label="Start at (min)" tip="Simulation minute when evacuation begins">
            <input type="number" min={0} max={120} value={c.evacuationTime}
              onChange={e => set('evacuationTime', +e.target.value)} style={inp} />
          </Row>
          <Row label="Panic speed ×" tip="Speed multiplier during evacuation (>1 = faster)">
            <input type="number" min={1} max={3} step={0.1} value={c.panicSpeedMultiplier}
              onChange={e => set('panicSpeedMultiplier', +e.target.value)} style={inp} />
          </Row>
        </>}
      </Section>

      <Section title="Safety Thresholds">
        <Row label="Warning (pers/m²)" tip="Density at which yellow warning is shown (typical: 2)">
          <input type="number" min={0.5} max={6} step={0.5} value={c.densityWarning}
            onChange={e => set('densityWarning', +e.target.value)} style={inp} />
        </Row>
        <Row label="Danger (pers/m²)" tip="Density deemed dangerous; red alert (typical: 4)">
          <input type="number" min={1} max={10} step={0.5} value={c.densityDanger}
            onChange={e => set('densityDanger', +e.target.value)} style={inp} />
        </Row>
        <Row label="Heatmap cell (m)" tip="Grid cell size for density calculation">
          <select value={c.cellSize} onChange={e => set('cellSize', +e.target.value)}
            style={{ ...inp, width: 60 }}>
            {[0.5, 1, 2].map(v => <option key={v} value={v}>{v}m</option>)}
          </select>
        </Row>
      </Section>

      <Section title="Sweep Config">
        <Row label="Min N" tip="Minimum participants to test in sweep">
          <input type="number" min={100} max={5000} step={100} value={c.sweepMinN}
            onChange={e => set('sweepMinN', +e.target.value)} style={inp} />
        </Row>
        <Row label="Max N" tip="Maximum participants to test in sweep">
          <input type="number" min={100} max={5000} step={100} value={c.sweepMaxN}
            onChange={e => set('sweepMaxN', +e.target.value)} style={inp} />
        </Row>
        <Row label="Step" tip="Increment between test values">
          <input type="number" min={50} max={500} step={50} value={c.sweepStep}
            onChange={e => set('sweepStep', +e.target.value)} style={inp} />
        </Row>
        <Row label="P95 egress limit (min)" tip="Maximum acceptable p95 egress time for 'safe' result">
          <input type="number" min={1} max={30} step={0.5} value={c.egresTimeLimitMin}
            onChange={e => set('egresTimeLimitMin', +e.target.value)} style={inp} />
        </Row>
        <Row label="Warning time limit (%)" tip="Max % of simulation time density can exceed warning threshold">
          <input type="number" min={0} max={50} step={1} value={c.warningTimeLimitPct}
            onChange={e => set('warningTimeLimitPct', +e.target.value)} style={inp} />
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6, borderBottom: '1px solid #374151', paddingBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    flex: 1, padding: '6px 8px', borderRadius: 6,
    background: `${color}22`, color, border: `1px solid ${color}`,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
  };
}
