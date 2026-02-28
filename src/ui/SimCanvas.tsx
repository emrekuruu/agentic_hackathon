import React, { useRef, useEffect, useCallback } from 'react';
import { SimFrame, VenueLayout, SimConfig } from '../models/types';

interface Props {
  frame: SimFrame;
  layout: VenueLayout;
  config: SimConfig;
  showHeatmap: boolean;
  showAgents: boolean;
  showBottlenecks: boolean;
  fireMode?: boolean;
  onFireClick?: (wx: number, wy: number) => void;
}

const SCALE = 10; // pixels per metre

// Heatmap colour: cool → warm
function heatColor(density: number, danger: number): string {
  const t = Math.min(1, density / danger);
  if (t < 0.33) {
    const s = t / 0.33;
    return `rgba(0,${Math.floor(180 + 75 * s)},0,${0.3 + 0.3 * s})`;
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    return `rgba(${Math.floor(255 * s)},${Math.floor(255 - 55 * s)},0,0.5)`;
  } else {
    const s = (t - 0.66) / 0.34;
    return `rgba(255,${Math.floor(200 - 200 * s)},0,${0.55 + 0.3 * s})`;
  }
}

const STATE_COLOR: Record<string, string> = {
  seeking_attractor: '#60a5fa',
  queuing:           '#f59e0b',
  at_attractor:      '#a78bfa',
  seeking_exit:      '#34d399',
  evacuating:        '#f87171',
  exited:            'transparent',
};

export default function SimCanvas({ frame, layout, config, showHeatmap, showAgents, showBottlenecks, fireMode, onFireClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!fireMode || !onFireClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width)  * layout.width;
    const wy = ((e.clientY - rect.top)  / rect.height) * layout.height;
    onFireClick(wx, wy);
  }, [fireMode, onFireClick, layout.width, layout.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = layout.width  * SCALE;
    const H = layout.height * SCALE;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    // ── Heatmap ─────────────────────────────────────────────────────────────
    if (showHeatmap && frame.densityGrid.length > 0) {
      const cs = config.cellSize * SCALE;
      for (let r = 0; r < frame.gridRows; r++) {
        for (let c = 0; c < frame.gridCols; c++) {
          const d = frame.densityGrid[r][c];
          if (d < 0.05) continue;
          ctx.fillStyle = heatColor(d, config.densityDanger);
          ctx.fillRect(c * cs, r * cs, cs, cs);
        }
      }
    }

    // ── Bottleneck highlight ─────────────────────────────────────────────────
    if (showBottlenecks && frame.densityGrid.length > 0) {
      const cs = config.cellSize * SCALE;
      for (let r = 0; r < frame.gridRows; r++) {
        for (let c = 0; c < frame.gridCols; c++) {
          if (frame.densityGrid[r][c] >= config.densityDanger) {
            ctx.strokeStyle = 'rgba(255,50,50,0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(c * cs + 1, r * cs + 1, cs - 2, cs - 2);
          }
        }
      }
    }

    // ── Smoke ─────────────────────────────────────────────────────────────────
    if (frame.smokeGrid && frame.fireCols && frame.fireRows) {
      const cs = W / frame.fireCols;
      for (let r = 0; r < frame.fireRows; r++) {
        for (let c = 0; c < frame.fireCols; c++) {
          const s = frame.smokeGrid[r][c];
          if (s < 0.05) continue;
          ctx.fillStyle = `rgba(80,85,100,${Math.min(0.85, s * 0.72)})`;
          ctx.fillRect(c * cs, r * cs, cs, cs);
        }
      }
    }

    // ── Fire ─────────────────────────────────────────────────────────────────
    if (frame.fireGrid && frame.fireCols && frame.fireRows) {
      const cs = W / frame.fireCols;
      for (let r = 0; r < frame.fireRows; r++) {
        for (let c = 0; c < frame.fireCols; c++) {
          if (!frame.fireGrid[r][c]) continue;
          const flicker = Math.sin(frame.simTime * 7 + r * 2.3 + c * 1.9) * 0.5 + 0.5;
          const g = Math.floor(40 + flicker * 100);
          ctx.fillStyle = `rgba(255,${g},0,${0.65 + flicker * 0.25})`;
          ctx.fillRect(c * cs, r * cs, cs, cs);
        }
      }
    }

    // ── Walls ────────────────────────────────────────────────────────────────
    ctx.fillStyle   = '#374151';
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth   = 1;
    for (const w of layout.walls) {
      ctx.fillRect(w.rect.x * SCALE, w.rect.y * SCALE, w.rect.w * SCALE, w.rect.h * SCALE);
      ctx.strokeRect(w.rect.x * SCALE, w.rect.y * SCALE, w.rect.w * SCALE, w.rect.h * SCALE);
    }

    // ── Entrances ────────────────────────────────────────────────────────────
    for (const en of layout.entrances) {
      ctx.fillStyle = '#22c55e';
      ctx.fillRect((en.x - en.width / 2) * SCALE, (en.y - 0.5) * SCALE, en.width * SCALE, 1 * SCALE);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('IN', en.x * SCALE, (en.y + 0.1) * SCALE);
    }

    // ── Exits ────────────────────────────────────────────────────────────────
    for (const ex of layout.exits) {
      const blocked = frame.blockedExits?.includes(ex.id) ?? false;
      const ex1 = (ex.x - ex.width / 2) * SCALE;
      const ey1 = (ex.y - 0.5) * SCALE;
      const ew  = ex.width * SCALE;
      ctx.fillStyle = blocked ? '#1f2937' : '#ef4444';
      ctx.fillRect(ex1, ey1, ew, SCALE);
      if (blocked) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ex1, ey1);         ctx.lineTo(ex1 + ew, ey1 + SCALE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex1 + ew, ey1);   ctx.lineTo(ex1, ey1 + SCALE);      ctx.stroke();
      }
      ctx.fillStyle = blocked ? '#f87171' : '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(blocked ? 'CLOSED' : 'EXIT', ex.x * SCALE, (ex.y + 0.1) * SCALE);
    }

    // ── Attractors ───────────────────────────────────────────────────────────
    for (const att of layout.attractors) {
      ctx.beginPath();
      ctx.arc(att.x * SCALE, att.y * SCALE, att.radius * SCALE, 0, Math.PI * 2);
      ctx.fillStyle   = 'rgba(245,158,11,0.15)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth   = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fcd34d';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(att.label, att.x * SCALE, att.y * SCALE + 4);
    }

    // ── Agents ───────────────────────────────────────────────────────────────
    if (showAgents) {
      for (const a of frame.agents) {
        const color = STATE_COLOR[a.state] ?? '#ccc';
        ctx.beginPath();
        ctx.arc(a.x * SCALE, a.y * SCALE, Math.max(1.5, a.radius * SCALE), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    // ── Firefighters ─────────────────────────────────────────────────────────
    if (frame.firefighters && frame.fireCols) {
      const cs = W / frame.fireCols;
      for (const ff of frame.firefighters) {
        const px = ff.x * SCALE, py = ff.y * SCALE;

        // Water hose beam while extinguishing
        if (ff.extinguishing && ff.targetRow !== undefined && ff.targetCol !== undefined) {
          const tx = (ff.targetCol + 0.5) * cs, ty = (ff.targetRow + 0.5) * cs;
          // Target cell highlight (steam/water)
          ctx.fillStyle = 'rgba(125,211,252,0.45)';
          ctx.fillRect(ff.targetCol * cs, ff.targetRow * cs, cs, cs);
          // Hose line
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = 'rgba(125,211,252,0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.restore();
        }

        // Body
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = ff.extinguishing ? '#38bdf8' : '#1e40af';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = 'bold 5px monospace';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('FF', px, py + 2);
      }
    }

    // ── "Fire!" speech bubbles ───────────────────────────────────────────────
    if (showAgents && frame.fireGrid && frame.fireCols && frame.fireRows) {
      const DETECT_R = 5; // cells (metres) within which agent notices fire
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      for (const a of frame.agents) {
        if (a.state !== 'evacuating') continue;
        const gr = Math.floor(a.y), gc = Math.floor(a.x);
        let near = false;
        outer: for (let dr = -DETECT_R; dr <= DETECT_R && !near; dr++) {
          for (let dc = -DETECT_R; dc <= DETECT_R; dc++) {
            const nr = gr + dr, nc = gc + dc;
            if (nr < 0 || nr >= frame.fireRows! || nc < 0 || nc >= frame.fireCols!) continue;
            if (frame.fireGrid[nr][nc]) { near = true; break outer; }
          }
        }
        if (!near) continue;
        const px = a.x * SCALE;
        const py = (a.y - a.radius) * SCALE - 3;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(px - 13, py - 9, 26, 11);
        ctx.fillStyle = '#fca5a5';
        ctx.fillText('🔥 Fire!', px, py);
      }
    }

    // ── Venue border ─────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, W, H);

    // ── Legend ───────────────────────────────────────────────────────────────
    const legend = [
      { color: '#60a5fa', label: 'Seeking attractor' },
      { color: '#f59e0b', label: 'Queuing' },
      { color: '#a78bfa', label: 'At attractor' },
      { color: '#34d399', label: 'Seeking exit' },
      { color: '#f87171', label: 'Evacuating' },
      { color: '#f97316', label: 'Fire' },
      { color: '#50556450', label: 'Smoke' },
      { color: '#1e40af', label: 'Firefighter' },
    ];
    const lx = 6, ly = H - 6 - legend.length * 16;
    ctx.font = '10px monospace';
    legend.forEach((item, i) => {
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, ly + i * 16, 10, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, lx + 14, ly + i * 16 + 9);
    });

    // ── HUD ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W - 130, 6, 124, 42);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    const t = frame.simTime;
    const min = Math.floor(t / 60), sec = Math.floor(t % 60);
    ctx.fillText(`T: ${min}:${sec.toString().padStart(2, '0')}`, W - 124, 22);
    ctx.fillText(`N: ${frame.agents.length} active`, W - 124, 38);

    if (frame.isEvacuating) {
      const hasFire = frame.fireGrid?.some(row => row.includes(true));
      if (hasFire) {
        const flash = Math.floor(frame.simTime * 3) % 2 === 0;
        ctx.fillStyle = flash ? 'rgba(220,38,38,0.92)' : 'rgba(127,29,29,0.88)';
        ctx.fillRect(0, 0, W, 22);
        ctx.fillStyle = '#fef2f2';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🔥 FIRE ALARM — EVACUATE IMMEDIATELY', W / 2, 15);
      } else {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ EVACUATION', W / 2, 18);
      }
    }
  }, [frame, layout, config, showHeatmap, showAgents, showBottlenecks]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ display: 'block', border: '1px solid #374151', borderRadius: 4, width: '100%', height: 'auto', cursor: fireMode ? 'crosshair' : 'default' }}
    />
  );
}
