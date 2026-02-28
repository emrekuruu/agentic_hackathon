import React from 'react';
import { Metrics, SimConfig, VenueLayout } from '../models/types';

interface Props {
  metrics: Metrics;
  config: SimConfig;
  layout: VenueLayout;
  simTime: number;
  isEvacuating: boolean;
}

function KPI({ label, value, unit, warn, danger, tip }: {
  label: string; value: string | number; unit?: string;
  warn?: boolean; danger?: boolean; tip?: string;
}) {
  const color = danger ? '#f87171' : warn ? '#f59e0b' : '#34d399';
  return (
    <div title={tip} style={{
      background: '#1e2433', border: `1px solid ${danger ? '#ef4444' : warn ? '#f59e0b' : '#374151'}`,
      borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'monospace' }}>
        {value}{unit && <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 4 }}>{unit}</span>}
      </span>
    </div>
  );
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtMin(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

export default function MetricsPanel({ metrics: m, config: c, layout, simTime, isEvacuating }: Props) {
  const venueArea = layout.width * layout.height -
    layout.walls.reduce((s, w) => s + w.rect.w * w.rect.h, 0);

  const avgDensity = venueArea > 0 ? m.activeAgents / venueArea : 0;
  const warnPct = simTime > 0 ? (m.timeAboveWarning / simTime * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <KPI
          label="Sim time" value={fmtTime(simTime)} unit="m:s"
          tip="Elapsed simulation time"
        />
        <KPI
          label="Active agents" value={m.activeAgents}
          tip="Agents currently in venue"
        />
        <KPI
          label="Exited" value={m.exitedAgents}
          tip="Agents who reached an exit"
        />
        <KPI
          label="Peak density" value={m.peakDensity.toFixed(2)} unit="p/m²"
          warn={m.peakDensity >= c.densityWarning}
          danger={m.peakDensity >= c.densityDanger}
          tip="Highest density recorded in any cell this run"
        />
        <KPI
          label="Cur. max density" value={m.currentMaxDensity.toFixed(2)} unit="p/m²"
          warn={m.currentMaxDensity >= c.densityWarning}
          danger={m.currentMaxDensity >= c.densityDanger}
          tip="Current highest density cell"
        />
        <KPI
          label="Avg density" value={avgDensity.toFixed(2)} unit="p/m²"
          tip="Average over passable venue area"
        />
        <KPI
          label="Time > warning" value={m.timeAboveWarning.toFixed(0)} unit="s"
          warn={warnPct > c.warningTimeLimitPct}
          tip={`Seconds any cell exceeded ${c.densityWarning} p/m² (${warnPct.toFixed(1)}% of sim time)`}
        />
        <KPI
          label="Time > danger" value={m.timeAboveDanger.toFixed(0)} unit="s"
          danger={m.timeAboveDanger > 0}
          tip={`Seconds any cell exceeded ${c.densityDanger} p/m²`}
        />
        {isEvacuating && <>
          <KPI
            label="Avg egress" value={fmtMin(m.avgEgressTime)} unit="min"
            tip="Average time from spawn to exit"
          />
          <KPI
            label="p95 egress" value={fmtMin(m.p95EgressTime)} unit="min"
            warn={m.p95EgressTime / 60 > c.egresTimeLimitMin}
            danger={m.p95EgressTime / 60 > c.egresTimeLimitMin * 1.5}
            tip="95th-percentile egress time (only agents who exited so far)"
          />
        </>}
      </div>

      {/* Queue lengths */}
      {layout.attractors.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em',
                        textTransform: 'uppercase', marginBottom: 6, borderBottom: '1px solid #374151', paddingBottom: 4 }}>
            Queue lengths
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {layout.attractors.map(att => {
              const len = m.queueLengths[att.id] ?? 0;
              return (
                <div key={att.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af' }}>
                  <span>{att.label}</span>
                  <span style={{ color: len > att.queueCapacity * 0.8 ? '#f59e0b' : '#9ca3af', fontFamily: 'monospace' }}>
                    {len} / {att.queueCapacity}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick status bar */}
      <StatusBar warn={warnPct > c.warningTimeLimitPct} danger={m.timeAboveDanger > 0} evacuating={isEvacuating} />
    </div>
  );
}

function StatusBar({ warn, danger, evacuating }: { warn: boolean; danger: boolean; evacuating: boolean }) {
  if (evacuating) return (
    <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 6, padding: '8px 12px',
                  color: '#fca5a5', fontWeight: 600, fontSize: 12, textAlign: 'center' }}>
      ⚠ EVACUATION IN PROGRESS
    </div>
  );
  if (danger) return (
    <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 6, padding: '8px 12px',
                  color: '#fca5a5', fontWeight: 600, fontSize: 12, textAlign: 'center' }}>
      DANGER: density exceeds {String.fromCharCode(9679)} safe limit
    </div>
  );
  if (warn) return (
    <div style={{ background: '#451a03', border: '1px solid #f59e0b', borderRadius: 6, padding: '8px 12px',
                  color: '#fcd34d', fontWeight: 600, fontSize: 12, textAlign: 'center' }}>
      WARNING: elevated density detected
    </div>
  );
  return (
    <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: 6, padding: '8px 12px',
                  color: '#86efac', fontWeight: 600, fontSize: 12, textAlign: 'center' }}>
      ✓ Normal conditions
    </div>
  );
}
