import React, { useState, useCallback } from 'react';
import { SimConfig, Scenario, SweepResult, VenueLayout } from '../models/types';
import { runSweep } from '../sim/engine';

interface Props {
  scenarios: Scenario[];
  currentLayout: VenueLayout;
  config: SimConfig;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateResults: (id: string, results: SweepResult[]) => void;
}

// ── Fruin Level of Service ─────────────────────────────────────────────────────
// Standard for standing-crowd assembly spaces (peak density p/m²)
function fruinLoS(density: number): { grade: string; color: string; desc: string } {
  if (density < 0.5) return { grade: 'A', color: '#22c55e', desc: 'Free flow — comfortable'       };
  if (density < 1.1) return { grade: 'B', color: '#84cc16', desc: 'Minor congestion'              };
  if (density < 2.2) return { grade: 'C', color: '#eab308', desc: 'Restricted movement'           };
  if (density < 3.5) return { grade: 'D', color: '#f97316', desc: 'Very restricted'               };
  if (density < 4.5) return { grade: 'E', color: '#ef4444', desc: 'Dangerous crowding'            };
  return               { grade: 'F', color: '#991b1b', desc: 'Crowd crush risk'                   };
}

// ── Quick compliance score ─────────────────────────────────────────────────────
function quickScore(
  layout: VenueLayout,
  config: SimConfig,
  safeMax: SweepResult | undefined,
): { pass: number; total: number } {
  const totalWidth = layout.exits.reduce((s, e) => s + e.width, 0);
  const area = layout.width * layout.height -
    layout.walls.reduce((s, w) => s + w.rect.w * w.rect.h, 0);
  let pass = 0, total = 3;
  if (layout.exits.length >= 2)              pass++;
  if ((totalWidth * 1000) / config.N >= 5)   pass++;
  if (area / config.N >= 0.5)               pass++;
  if (safeMax) {
    total += 4;
    if (config.N <= safeMax.N)                                      pass++;
    if (safeMax.p95EgressTime <= config.egresTimeLimitMin)          pass++;
    if (safeMax.peakDensity < config.densityDanger)                 pass++;
    if (safeMax.timeAboveWarningPct <= config.warningTimeLimitPct)  pass++;
  }
  return { pass, total };
}

// ── Mini venue footprint canvas ────────────────────────────────────────────────
function VenueThumbnail({ layout }: { layout: VenueLayout }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const sx = W / layout.width, sy = H / layout.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, W, H);
    // Walls
    ctx.fillStyle = '#374151';
    for (const w of layout.walls)
      ctx.fillRect(w.rect.x * sx, w.rect.y * sy, w.rect.w * sx, w.rect.h * sy);
    // Exits
    ctx.fillStyle = '#ef4444';
    for (const ex of layout.exits)
      ctx.fillRect((ex.x - ex.width / 2) * sx, (ex.y - 0.5) * sy, ex.width * sx, 1 * sy);
    // Entrances
    ctx.fillStyle = '#22c55e';
    for (const en of layout.entrances)
      ctx.fillRect((en.x - en.width / 2) * sx, (en.y - 0.5) * sy, en.width * sx, 1 * sy);
    // Attractors
    ctx.fillStyle = 'rgba(245,158,11,0.5)';
    for (const att of layout.attractors) {
      ctx.beginPath();
      ctx.arc(att.x * sx, att.y * sy, Math.max(2, att.radius * Math.min(sx, sy) * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    // Border
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, W, H);
  }, [layout]);
  return <canvas ref={ref} width={80} height={54} style={{ borderRadius: 3, display: 'block' }} />;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ScenarioManager({
  scenarios, currentLayout, config, onSave, onLoad, onDelete, onUpdateResults,
}: Props) {
  const [nameInput, setNameInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState('');

  const handleSave = () => {
    const name = nameInput.trim() || `Layout ${scenarios.length + 1}`;
    onSave(name);
    setNameInput('');
  };

  const runAllSweeps = useCallback(async () => {
    const queue = scenarios.filter(s => s.sweepResults.length === 0);
    if (queue.length === 0) return;
    setAnalyzing(true);
    for (let i = 0; i < queue.length; i++) {
      const s = queue[i];
      setAnalyzeProgress(`Analyzing "${s.name}" (${i + 1}/${queue.length})…`);
      await new Promise<void>(resolve => {
        setTimeout(() => {
          const results = runSweep(s.layout, config, () => {});
          onUpdateResults(s.id, results);
          resolve();
        }, 0);
      });
    }
    setAnalyzeProgress('');
    setAnalyzing(false);
  }, [scenarios, config, onUpdateResults]);

  // Derived data for each scenario
  const rows = scenarios.map(s => {
    const passed  = s.sweepResults.filter(r => r.passed);
    const safeMax = passed.length > 0 ? passed[passed.length - 1] : undefined;
    const los     = safeMax ? fruinLoS(safeMax.peakDensity) : null;
    const score   = quickScore(s.layout, config, safeMax);
    const totalExitW = s.layout.exits.reduce((a, e) => a + e.width, 0);
    return { ...s, safeMax, los, score, totalExitW };
  });

  // Best-performer values per column
  const withData  = rows.filter(r => r.safeMax);
  const bestN     = withData.length ? Math.max(...withData.map(r => r.safeMax!.N)) : -1;
  const bestEgr   = withData.length ? Math.min(...withData.map(r => r.safeMax!.p95EgressTime)) : Infinity;
  const bestDens  = withData.length ? Math.min(...withData.map(r => r.safeMax!.peakDensity)) : Infinity;

  const unanalyzed = scenarios.filter(s => s.sweepResults.length === 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
        Save multiple venue layouts as scenarios, run the safety estimator on each, and compare their
        performance side by side. Identifies the layout with the highest safe capacity, fastest evacuation,
        and best Fruin Level of Service grade.
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder={`e.g. "3 exits — centre corridor"`}
          style={{
            flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 6, fontSize: 12,
            background: '#1f2937', border: '1px solid #374151', color: '#e5e7eb', outline: 'none',
          }}
        />
        <button onClick={handleSave} style={ctrlBtn('#1d4ed8', '#60a5fa')}>
          + Save Current Layout
        </button>
        {unanalyzed > 0 && (
          <button onClick={runAllSweeps} disabled={analyzing} style={ctrlBtn('#7c3aed', '#a78bfa', analyzing)}>
            {analyzing
              ? analyzeProgress
              : `▶ Analyze ${unanalyzed} scenario${unanalyzed > 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* Empty state */}
      {scenarios.length === 0 && (
        <div style={{
          background: '#1f2937', border: '1px dashed #374151', borderRadius: 8,
          padding: 32, textAlign: 'center', color: '#6b7280',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📐</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 6 }}>
            No scenarios saved yet
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            Use the <strong style={{ color: '#9ca3af' }}>Venue Editor</strong> to design layouts, then save
            each variant here.<br />
            Try: more exits, wider corridors, different exit positions, or extra emergency doors.
          </div>
        </div>
      )}

      {/* Comparison table */}
      {scenarios.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #1f2937' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#1a2033' }}>
                  <th style={th()}>Venue</th>
                  <th style={th()}>Layout</th>
                  <th style={th('right')}>Safe max N</th>
                  <th style={th('right')}>P95 egress</th>
                  <th style={th('right')}>Peak density</th>
                  <th style={th('center')}>Fruin LoS</th>
                  <th style={th('center')}>Compliance</th>
                  <th style={th('center')}>Status</th>
                  <th style={th('center')}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isBestN    = row.safeMax?.N === bestN && bestN >= 0;
                  const isBestEgr  = row.safeMax?.p95EgressTime === bestEgr;
                  const isBestDens = row.safeMax?.peakDensity === bestDens;
                  const scoreColor = row.score.pass === row.score.total ? '#4ade80'
                    : row.score.pass >= row.score.total * 0.7 ? '#f59e0b' : '#f87171';

                  return (
                    <tr key={row.id} style={{
                      background: i % 2 === 0 ? '#111827' : '#0f1117',
                      borderBottom: '1px solid #1f2937',
                    }}>
                      {/* Thumbnail + name */}
                      <td style={{ ...td(), minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <VenueThumbnail layout={row.layout} />
                          <div>
                            <div style={{ fontWeight: 600, color: '#e5e7eb', lineHeight: 1.3 }}>{row.name}</div>
                            <div style={{ fontSize: 10, color: '#4b5563' }}>
                              {row.layout.width}×{row.layout.height}m
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Exit summary */}
                      <td style={{ ...td(), color: '#9ca3af', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {row.layout.exits.length} exits<br />
                        <span style={{ color: '#6b7280' }}>{row.totalExitW.toFixed(1)}m wide</span>
                      </td>

                      {/* Safe max N */}
                      <td style={{ ...td('right'), fontFamily: 'monospace' }}>
                        {row.safeMax
                          ? <span style={{ color: isBestN ? '#4ade80' : '#d1d5db', fontWeight: isBestN ? 700 : 400 }}>
                              {isBestN && <span title="Best safe capacity">★ </span>}
                              {row.safeMax.N.toLocaleString()}
                            </span>
                          : <span style={{ color: '#374151' }}>—</span>}
                      </td>

                      {/* P95 egress */}
                      <td style={{ ...td('right'), fontFamily: 'monospace' }}>
                        {row.safeMax
                          ? <span style={{ color: isBestEgr ? '#4ade80' : '#d1d5db', fontWeight: isBestEgr ? 700 : 400 }}>
                              {isBestEgr && <span title="Fastest evacuation">★ </span>}
                              {row.safeMax.p95EgressTime.toFixed(1)} min
                            </span>
                          : <span style={{ color: '#374151' }}>—</span>}
                      </td>

                      {/* Peak density */}
                      <td style={{ ...td('right'), fontFamily: 'monospace' }}>
                        {row.safeMax
                          ? <span style={{ color: isBestDens ? '#4ade80' : '#d1d5db', fontWeight: isBestDens ? 700 : 400 }}>
                              {isBestDens && <span title="Lowest peak density">★ </span>}
                              {row.safeMax.peakDensity.toFixed(2)} p/m²
                            </span>
                          : <span style={{ color: '#374151' }}>—</span>}
                      </td>

                      {/* Fruin LoS badge */}
                      <td style={{ ...td('center') }}>
                        {row.los
                          ? <span title={row.los.desc} style={{
                              display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                              background: `${row.los.color}22`, border: `1px solid ${row.los.color}`,
                              color: row.los.color, fontWeight: 800, fontSize: 14, letterSpacing: '0.02em',
                            }}>
                              {row.los.grade}
                              <span style={{ fontSize: 9, marginLeft: 3, fontWeight: 400 }}>{row.los.desc}</span>
                            </span>
                          : <span style={{ color: '#374151' }}>—</span>}
                      </td>

                      {/* Compliance */}
                      <td style={{ ...td('center') }}>
                        <span style={{ color: scoreColor, fontWeight: 600, fontFamily: 'monospace' }}>
                          {row.score.pass}/{row.score.total}
                        </span>
                        <div style={{ fontSize: 10, color: '#4b5563' }}>
                          {row.sweepResults.length === 0 ? 'basic only' : 'checks'}
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ ...td('center') }}>
                        {row.sweepResults.length === 0
                          ? <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>Not analyzed</span>
                          : <span style={{ fontSize: 11, color: '#34d399' }}>
                              ✓ Analyzed
                              {row.ranAt && <><br /><span style={{ fontSize: 10, color: '#374151' }}>{new Date(row.ranAt).toLocaleTimeString()}</span></>}
                            </span>}
                      </td>

                      {/* Actions */}
                      <td style={{ ...td('center') }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <button
                            onClick={() => onLoad(row.id)}
                            title="Load this layout into the editor and simulation"
                            style={actionBtn('#1d4ed8', '#60a5fa')}
                          >
                            Load
                          </button>
                          <button
                            onClick={() => onDelete(row.id)}
                            title="Remove this scenario"
                            style={actionBtn('#7f1d1d', '#fca5a5')}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Star legend */}
          {withData.length > 1 && (
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              ★ = best performer in that column
            </div>
          )}

          {/* Fruin LoS reference card */}
          <div style={{ borderTop: '1px solid #1f2937', paddingTop: 10 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#4b5563',
              letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
            }}>
              Fruin Level of Service — Peak Crowd Density Reference
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {([
                { g: 'A', r: '< 0.5', c: '#22c55e', d: 'Free flow'      },
                { g: 'B', r: '0.5–1.1', c: '#84cc16', d: 'Minor'         },
                { g: 'C', r: '1.1–2.2', c: '#eab308', d: 'Restricted'    },
                { g: 'D', r: '2.2–3.5', c: '#f97316', d: 'Very restricted'},
                { g: 'E', r: '3.5–4.5', c: '#ef4444', d: 'Dangerous'     },
                { g: 'F', r: '> 4.5',   c: '#991b1b', d: 'Crush risk'    },
              ] as const).map(({ g, r, c, d }) => (
                <div key={g} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px', borderRadius: 4,
                  background: `${c}15`, border: `1px solid ${c}40`,
                }}>
                  <span style={{ fontWeight: 800, color: c, fontSize: 13 }}>{g}</span>
                  <span style={{ color: '#6b7280', fontSize: 10 }}>{r} p/m² · {d}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────────────
function th(align: 'left' | 'right' | 'center' = 'left'): React.CSSProperties {
  return {
    padding: '9px 10px', textAlign: align, fontSize: 10,
    color: '#6b7280', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.07em', whiteSpace: 'nowrap', borderBottom: '1px solid #374151',
  };
}

function td(align: 'left' | 'right' | 'center' = 'left'): React.CSSProperties {
  return { padding: '10px', textAlign: align, verticalAlign: 'middle' };
}

function ctrlBtn(border: string, color: string, disabled = false): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    background: disabled ? '#1f2937' : `${border}22`,
    color: disabled ? '#6b7280' : color,
    border: `1px solid ${disabled ? '#374151' : border}`,
    whiteSpace: 'nowrap' as const,
  };
}

function actionBtn(bg: string, color: string): React.CSSProperties {
  return {
    padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
    background: `${bg}22`, color, border: `1px solid ${bg}`,
  };
}
