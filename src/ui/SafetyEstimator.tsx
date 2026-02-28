import { useRef, useEffect, useState, useCallback } from 'react';
import { SimConfig, SweepResult, VenueLayout } from '../models/types';
import { runSweep } from '../sim/engine';

interface Props {
  config: SimConfig;
  layout: VenueLayout;
}

interface ComplianceCheck {
  label: string;
  detail: string;
  pass: boolean;
}

function getComplianceChecks(
  layout: VenueLayout,
  config: SimConfig,
  safeMax: SweepResult | undefined,
): ComplianceCheck[] {
  const totalExitWidth = layout.exits.reduce((s, ex) => s + ex.width, 0);
  const venueArea = layout.width * layout.height -
    layout.walls.reduce((s, w) => s + w.rect.w * w.rect.h, 0);
  const mmPerPerson = totalExitWidth > 0 ? (totalExitWidth * 1000) / config.N : 0;
  const m2PerPerson = venueArea / config.N;

  const checks: ComplianceCheck[] = [
    {
      label: 'Min. 2 means of egress (NFPA 101 §7.4)',
      pass: layout.exits.length >= 2,
      detail: `${layout.exits.length} exit${layout.exits.length !== 1 ? 's' : ''} defined`,
    },
    {
      label: 'Exit width ≥ 5 mm/person (level egress)',
      pass: mmPerPerson >= 5,
      detail: `${mmPerPerson.toFixed(1)} mm/person (total ${(totalExitWidth * 1000).toFixed(0)} mm for N=${config.N})`,
    },
    {
      label: 'Floor space ≥ 0.5 m²/person (standing event)',
      pass: m2PerPerson >= 0.5,
      detail: `${m2PerPerson.toFixed(2)} m²/person over ${venueArea.toFixed(0)} m² usable area`,
    },
  ];

  if (safeMax) {
    checks.push(
      {
        label: `Configured capacity ≤ safe max (${safeMax.N})`,
        pass: config.N <= safeMax.N,
        detail: `Configured N = ${config.N}; estimated safe max = ${safeMax.N}`,
      },
      {
        label: `P95 egress ≤ ${config.egresTimeLimitMin} min target`,
        pass: safeMax.p95EgressTime <= config.egresTimeLimitMin,
        detail: `${safeMax.p95EgressTime.toFixed(1)} min at N=${safeMax.N}`,
      },
      {
        label: `Peak density < ${config.densityDanger} p/m² (danger threshold)`,
        pass: safeMax.peakDensity < config.densityDanger,
        detail: `${safeMax.peakDensity.toFixed(2)} p/m² at N=${safeMax.N}`,
      },
      {
        label: `Time above warning density ≤ ${config.warningTimeLimitPct}%`,
        pass: safeMax.timeAboveWarningPct <= config.warningTimeLimitPct,
        detail: `${safeMax.timeAboveWarningPct.toFixed(1)}% at N=${safeMax.N}`,
      },
    );
  }

  return checks;
}

export default function SafetyEstimator({ config, layout }: Props) {
  const [results, setResults] = useState<SweepResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const chartRef = useRef<HTMLCanvasElement>(null);

  const passed  = results.filter(r => r.passed);
  const safeMax = passed.length > 0 ? passed[passed.length - 1] : undefined;

  const runEstimator = () => {
    if (layout.entrances.length === 0 || layout.exits.length === 0) {
      alert('Add at least one entrance and one exit to the venue first.');
      return;
    }
    setRunning(true);
    setResults([]);
    setProgress(0);
    setTimeout(() => {
      const sweep = runSweep(layout, config, (done, tot) => {
        setProgress(done);
        setTotal(tot);
      });
      setResults(sweep);
      setRunning(false);
    }, 0);
  };

  const handlePrintReport = useCallback(() => {
    const checks = getComplianceChecks(layout, config, safeMax);
    const passCount = checks.filter(c => c.pass).length;
    const rowsHtml = results.map(r =>
      `<tr class="${r.passed ? 'pass-row' : 'fail-row'}">
        <td>${r.N}</td>
        <td>${r.peakDensity.toFixed(2)} p/m²</td>
        <td>${r.p95EgressTime.toFixed(1)} min</td>
        <td>${r.timeAboveWarningPct.toFixed(1)}%</td>
        <td><b>${r.passed ? '✓ PASS' : '✗ FAIL'}</b></td>
      </tr>`
    ).join('');

    const checkRows = checks.map(c =>
      `<tr>
        <td>${c.label}</td>
        <td class="${c.pass ? 'pass' : 'fail'}"><b>${c.pass ? '✓ PASS' : '✗ FAIL'}</b></td>
        <td style="color:#555">${c.detail}</td>
      </tr>`
    ).join('');

    const totalExitWidth = layout.exits.reduce((s, ex) => s + ex.width, 0);
    const venueArea = layout.width * layout.height -
      layout.walls.reduce((s, w) => s + w.rect.w * w.rect.h, 0);

    const reportHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>CrowdFlow Safety Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #111; padding: 32px 40px; max-width: 800px; margin: auto; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  .meta { color: #555; font-size: 13px; margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
  h2 { font-size: 15px; margin: 20px 0 8px; color: #1a1a2e; }
  .summary-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-bottom: 20px; }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; }
  .kpi-label { font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: .05em; }
  .kpi-value { font-size: 26px; font-weight: 900; color: #1a1a2e; }
  .kpi-sub { font-size: 11px; color: #999; }
  .safe-cap { background: #f0fdf4; border: 2px solid #16a34a; border-radius: 8px;
              padding: 14px 20px; text-align: center; margin-bottom: 20px; }
  .safe-cap .n { font-size: 48px; font-weight: 900; color: #15803d; line-height: 1.1; }
  .safe-cap .label { font-size: 12px; color: #166534; text-transform: uppercase; letter-spacing: .08em; }
  .no-safe { background: #fef2f2; border: 2px solid #dc2626; color: #991b1b; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f3f4f6; padding: 7px 10px; text-align: left; font-size: 12px; color: #555; border-bottom: 2px solid #ddd; }
  td { padding: 5px 10px; border-bottom: 1px solid #f0f0f0; }
  .pass { color: #16a34a; } .fail { color: #dc2626; }
  .pass-row { background: #f0fdf4; } .fail-row { background: #fef2f2; }
  .overall { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 13px; }
  .overall-pass { background: #f0fdf4; color: #15803d; border: 1px solid #16a34a; }
  .overall-fail { background: #fef2f2; color: #991b1b; border: 1px solid #dc2626; }
  @media print { button { display: none !important; } body { padding: 16px; } }
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div>
    <h1>🏟 CrowdFlow Venue Safety Report</h1>
    <div class="meta">
      Generated: ${new Date().toLocaleString()}&nbsp;&nbsp;|&nbsp;&nbsp;
      Venue: ${layout.width}m × ${layout.height}m&nbsp;&nbsp;|&nbsp;&nbsp;
      Configured N: ${config.N} persons
    </div>
  </div>
  <button onclick="window.print()" style="padding:8px 16px;border-radius:6px;background:#1d4ed8;color:#fff;border:none;cursor:pointer;font-size:13px">Print / Save PDF</button>
</div>

<div class="summary-grid">
  <div class="kpi">
    <div class="kpi-label">Venue area</div>
    <div class="kpi-value">${venueArea.toFixed(0)}<span style="font-size:16px;font-weight:normal"> m²</span></div>
    <div class="kpi-sub">${(venueArea / config.N).toFixed(2)} m²/person at N=${config.N}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Total exit width</div>
    <div class="kpi-value">${(totalExitWidth).toFixed(1)}<span style="font-size:16px;font-weight:normal"> m</span></div>
    <div class="kpi-sub">${layout.exits.length} exits · ${(totalExitWidth * 1000 / config.N).toFixed(1)} mm/person</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Compliance checks</div>
    <div class="kpi-value">${passCount}<span style="font-size:16px;font-weight:normal">/${checks.length}</span></div>
    <div class="kpi-sub">
      <span class="${passCount === checks.length ? 'overall overall-pass' : 'overall overall-fail'}">
        ${passCount === checks.length ? '✓ ALL PASS' : '✗ ACTION NEEDED'}
      </span>
    </div>
  </div>
</div>

${safeMax
  ? `<div class="safe-cap">
      <div class="label">Estimated safe max participants</div>
      <div class="n">${safeMax.N}</div>
      <div style="font-size:12px;color:#166534;margin-top:4px">
        Peak density: ${safeMax.peakDensity.toFixed(2)} p/m² &nbsp;|&nbsp;
        P95 egress: ${safeMax.p95EgressTime.toFixed(1)} min &nbsp;|&nbsp;
        Warn time: ${safeMax.timeAboveWarningPct.toFixed(1)}%
      </div>
    </div>`
  : `<div class="safe-cap no-safe">
      <div style="font-size:15px;font-weight:700">No configuration passed all safety criteria</div>
      <div style="font-size:12px;margin-top:4px">Consider adding exits, widening exits, or reducing crowd density.</div>
    </div>`}

<h2>Compliance Checklist</h2>
<table>
  <tr><th>Check</th><th>Result</th><th>Detail</th></tr>
  ${checkRows}
</table>

<h2>Sweep Results</h2>
<table>
  <tr><th>N</th><th>Peak Density</th><th>P95 Egress</th><th>Warn %</th><th>Pass?</th></tr>
  ${rowsHtml}
</table>

<h2>Venue Layout Summary</h2>
<table>
  <tr><th>Element</th><th>Count</th><th>Details</th></tr>
  <tr><td>Exits</td><td>${layout.exits.length}</td><td>IDs: ${layout.exits.map(e => `${e.id} (${e.width}m wide)`).join(', ')}</td></tr>
  <tr><td>Entrances</td><td>${layout.entrances.length}</td><td>IDs: ${layout.entrances.map(e => e.id).join(', ')}</td></tr>
  <tr><td>Attractions</td><td>${layout.attractors.length}</td><td>${layout.attractors.map(a => a.label).join(', ')}</td></tr>
  <tr><td>Obstacles / walls</td><td>${layout.walls.length}</td><td></td></tr>
</table>

<p style="font-size:11px;color:#aaa;margin-top:24px">
  Generated by CrowdFlow Simulator · Agent-based crowd simulation (social-force model, A* pathfinding)<br>
  This report is a simulation estimate. It does not substitute for a professionally certified fire-safety assessment.
</p>
</body></html>`;
    const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [layout, config, safeMax, results]);

  // Draw chart
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas || results.length === 0) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const PAD = { t: 20, r: 20, b: 40, l: 50 };
    const w = W - PAD.l - PAD.r;
    const h = H - PAD.t - PAD.b;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    const Ns    = results.map(r => r.N);
    const minN  = Ns[0], maxN = Ns[Ns.length - 1];
    const maxDens = Math.max(...results.map(r => r.peakDensity), config.densityDanger);
    const maxEgr  = Math.max(...results.map(r => r.p95EgressTime), config.egresTimeLimitMin);

    const xOf  = (N: number) => PAD.l + ((N - minN) / (maxN - minN || 1)) * w;
    const yOfD = (d: number) => PAD.t + h - (d / maxDens) * h;
    const yOfE = (e: number) => PAD.t + h - (e / maxEgr) * h;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = PAD.t + (h / 5) * i;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + w, y); ctx.stroke();
    }

    // Threshold lines
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#ef444466'; ctx.lineWidth = 1;
    const dy = yOfD(config.densityDanger);
    ctx.beginPath(); ctx.moveTo(PAD.l, dy); ctx.lineTo(PAD.l + w, dy); ctx.stroke();
    ctx.strokeStyle = '#f59e0b66';
    const ey = yOfE(config.egresTimeLimitMin);
    ctx.beginPath(); ctx.moveTo(PAD.l, ey); ctx.lineTo(PAD.l + w, ey); ctx.stroke();
    ctx.setLineDash([]);

    // Peak density line
    ctx.beginPath(); ctx.strokeStyle = '#f87171'; ctx.lineWidth = 2;
    results.forEach((r, i) => { const x = xOf(r.N), y = yOfD(r.peakDensity); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();

    // P95 egress line
    ctx.beginPath(); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2;
    results.forEach((r, i) => { const x = xOf(r.N), y = yOfE(r.p95EgressTime); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();

    // Pass/fail dots
    for (const r of results) {
      ctx.beginPath();
      ctx.arc(xOf(r.N), PAD.t + h + 6, 4, 0, Math.PI * 2);
      ctx.fillStyle = r.passed ? '#22c55e' : '#ef4444';
      ctx.fill();
    }

    // Safe-max marker
    if (safeMax) {
      const x = xOf(safeMax.N);
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + h); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axes
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t + h); ctx.lineTo(PAD.l + w, PAD.t + h); ctx.stroke();

    // Labels
    ctx.fillStyle = '#9ca3af'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('N participants', PAD.l + w / 2, H - 4);
    for (let i = 0; i <= 5; i++) {
      ctx.textAlign = 'right';
      ctx.fillText((maxDens / 5 * i).toFixed(1), PAD.l - 4, PAD.t + h - (h / 5) * i + 4);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f87171'; ctx.fillText('— peak density (p/m²)', PAD.l + 4, PAD.t + 14);
    ctx.fillStyle = '#60a5fa'; ctx.fillText('— p95 egress (min)',     PAD.l + 4, PAD.t + 26);
  }, [results, config, safeMax]);

  const checks = results.length > 0 ? getComplianceChecks(layout, config, safeMax) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
        Runs abbreviated simulations across a range of N values to find the highest safe capacity.
        Checks peak density, p95 egress time, and time above warning thresholds.
      </div>

      <button
        onClick={runEstimator}
        disabled={running}
        style={{
          padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: 13,
          background: running ? '#1f2937' : '#7c3aed22', color: running ? '#6b7280' : '#a78bfa',
          border: `1px solid ${running ? '#374151' : '#7c3aed'}`, cursor: running ? 'wait' : 'pointer',
        }}
      >
        {running ? `Running sweep… (${progress}/${total})` : '▶ Run Safety Estimator'}
      </button>

      {safeMax !== undefined && (
        <div style={{
          background: '#052e16', border: '2px solid #22c55e', borderRadius: 8,
          padding: '12px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, color: '#86efac', marginBottom: 4 }}>ESTIMATED SAFE MAX PARTICIPANTS</div>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace' }}>{safeMax.N}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
            Peak density: {safeMax.peakDensity.toFixed(2)} p/m² &nbsp;|&nbsp;
            P95 egress: {safeMax.p95EgressTime.toFixed(1)} min
          </div>
        </div>
      )}

      {results.length > 0 && safeMax === undefined && (
        <div style={{
          background: '#7f1d1d', border: '2px solid #ef4444', borderRadius: 8,
          padding: '12px 16px', textAlign: 'center', color: '#fca5a5', fontWeight: 600, fontSize: 13,
        }}>
          ✗ No configuration passed all safety criteria.<br />
          <span style={{ fontSize: 11, fontWeight: 400 }}>Reduce N or add / widen exits.</span>
        </div>
      )}

      {results.length > 0 && (
        <canvas
          ref={chartRef}
          width={380} height={200}
          style={{ borderRadius: 6, border: '1px solid #374151', width: '100%' }}
        />
      )}

      {/* Compliance checklist */}
      {checks.length > 0 && (
        <div>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 6, borderBottom: '1px solid #374151', paddingBottom: 4,
          }}>
            Compliance Checklist
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {checks.map(c => (
              <div key={c.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                gap: 8, fontSize: 11, padding: '5px 8px', borderRadius: 4,
                background: c.pass ? 'rgba(5,46,22,0.5)' : 'rgba(127,29,29,0.4)',
                border: `1px solid ${c.pass ? '#22c55e33' : '#ef444433'}`,
              }}>
                <span style={{ color: '#9ca3af', flex: 1 }}>{c.label}</span>
                <span style={{ color: c.pass ? '#4ade80' : '#f87171', fontFamily: 'monospace', whiteSpace: 'nowrap', fontWeight: 700 }}>
                  {c.pass ? '✓' : '✗'}
                </span>
              </div>
            ))}
          </div>
          {/* Detail table */}
          <div style={{ maxHeight: 140, overflowY: 'auto', marginTop: 6, fontSize: 10, color: '#6b7280', lineHeight: 1.6 }}>
            {checks.map(c => (
              <div key={c.label} style={{ display: 'flex', gap: 4 }}>
                <span style={{ color: c.pass ? '#4ade80' : '#f87171', minWidth: 10 }}>{c.pass ? '✓' : '✗'}</span>
                <span>{c.label}: <span style={{ color: '#9ca3af' }}>{c.detail}</span></span>
              </div>
            ))}
          </div>
          <button
            onClick={handlePrintReport}
            style={{
              marginTop: 8, width: '100%', padding: '6px 12px', borderRadius: 6, fontSize: 12,
              fontWeight: 700, cursor: 'pointer', background: '#1d4ed822',
              color: '#60a5fa', border: '1px solid #1d4ed8',
            }}
          >
            🖨 Print / Export Safety Report
          </button>
        </div>
      )}

      {/* Sweep table */}
      {results.length > 0 && (
        <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6b7280', borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', padding: '3px 6px' }}>N</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Peak dens.</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>P95 egr.</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Warn%</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Pass?</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.N} style={{ color: r.passed ? '#86efac' : '#f87171', borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '2px 6px' }}>{r.N}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{r.peakDensity.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{r.p95EgressTime.toFixed(1)} min</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{r.timeAboveWarningPct.toFixed(1)}%</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{r.passed ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
