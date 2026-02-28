import React, { useRef, useEffect, useCallback, useState } from 'react';
import { VenueLayout, EditorTool, Wall, Entrance, Exit, Attractor } from '../models/types';

interface Props {
  layout: VenueLayout;
  onChange: (layout: VenueLayout) => void;
}

const SCALE = 10; // pixels per metre
const TOOLS: { id: EditorTool; label: string; color: string; desc: string }[] = [
  { id: 'select',   label: 'Select',   color: '#888', desc: 'Select / delete elements' },
  { id: 'wall',     label: 'Wall',     color: '#555', desc: 'Drag to draw wall/obstacle' },
  { id: 'entrance', label: 'Entrance', color: '#22c55e', desc: 'Click to place spawn entrance' },
  { id: 'exit',     label: 'Exit',     color: '#ef4444', desc: 'Click to place evacuation exit' },
  { id: 'attractor',label: 'Attractor',color: '#f59e0b', desc: 'Click to place attractor (stage/bar/toilet)' },
];

let _eid = 100;

export default function VenueEditor({ layout, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool]         = useState<EditorTool>('wall');
  const [snapGrid, setSnapGrid] = useState(true);
  const [gridSize, setGridSize] = useState(2); // metres
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attLabel, setAttLabel] = useState('Stage');
  const [attWeight, setAttWeight] = useState(0.8);
  const [attServiceTime, setAttServiceTime] = useState(30);

  // Drag state
  const drag = useRef<{ startX: number; startY: number; dragging: boolean }>({
    startX: 0, startY: 0, dragging: false,
  });
  const [dragRect, setDragRect] = useState<{ x:number;y:number;w:number;h:number } | null>(null);

  const snap = useCallback((v: number) => {
    if (!snapGrid) return v;
    return Math.round(v / gridSize) * gridSize;
  }, [snapGrid, gridSize]);

  const canvasToWorld = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width  * layout.width,
      y: (e.clientY - rect.top)  / rect.height * layout.height,
    };
  };

  // ── Drawing ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = layout.width  * SCALE;
    const H = layout.height * SCALE;
    canvas.width  = W;
    canvas.height = H;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, W, H);

    // Grid
    if (snapGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 0.5;
      const gs = gridSize * SCALE;
      for (let x = 0; x <= W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }

    // Walls
    for (const w of layout.walls) {
      const sel = selectedId === w.id;
      ctx.fillStyle = sel ? '#7c7c9c' : '#4b4b6b';
      ctx.strokeStyle = sel ? '#a0a0d0' : '#6b6b9b';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.fillRect(w.rect.x * SCALE, w.rect.y * SCALE, w.rect.w * SCALE, w.rect.h * SCALE);
      ctx.strokeRect(w.rect.x * SCALE, w.rect.y * SCALE, w.rect.w * SCALE, w.rect.h * SCALE);
    }

    // Drag preview
    if (dragRect && tool === 'wall') {
      ctx.fillStyle = 'rgba(100,100,180,0.4)';
      ctx.strokeStyle = '#a0a0d0';
      ctx.lineWidth = 1;
      ctx.fillRect(dragRect.x * SCALE, dragRect.y * SCALE, dragRect.w * SCALE, dragRect.h * SCALE);
      ctx.strokeRect(dragRect.x * SCALE, dragRect.y * SCALE, dragRect.w * SCALE, dragRect.h * SCALE);
    }

    // Entrances
    for (const en of layout.entrances) {
      const sel = selectedId === en.id;
      ctx.fillStyle = sel ? '#86efac' : '#22c55e';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = sel ? 2 : 1;
      const hw = (en.width / 2) * SCALE;
      ctx.fillRect((en.x - en.width / 2) * SCALE, (en.y - 0.4) * SCALE, en.width * SCALE, 0.8 * SCALE);
      ctx.strokeRect((en.x - en.width / 2) * SCALE, (en.y - 0.4) * SCALE, en.width * SCALE, 0.8 * SCALE);
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('IN', en.x * SCALE, en.y * SCALE + 4);
      void hw;
    }

    // Exits
    for (const ex of layout.exits) {
      const sel = selectedId === ex.id;
      ctx.fillStyle = sel ? '#fca5a5' : '#ef4444';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.fillRect((ex.x - ex.width / 2) * SCALE, (ex.y - 0.4) * SCALE, ex.width * SCALE, 0.8 * SCALE);
      ctx.strokeRect((ex.x - ex.width / 2) * SCALE, (ex.y - 0.4) * SCALE, ex.width * SCALE, 0.8 * SCALE);
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('EXIT', ex.x * SCALE, ex.y * SCALE + 4);
    }

    // Attractors
    for (const att of layout.attractors) {
      const sel = selectedId === att.id;
      ctx.beginPath();
      ctx.arc(att.x * SCALE, att.y * SCALE, att.radius * SCALE, 0, Math.PI * 2);
      ctx.fillStyle = sel ? '#fde68a' : 'rgba(245,158,11,0.25)';
      ctx.fill();
      ctx.strokeStyle = sel ? '#fde68a' : '#f59e0b';
      ctx.lineWidth = sel ? 2 : 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(att.label, att.x * SCALE, att.y * SCALE + 4);
    }

    // Venue border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, W, H);
  }, [layout, dragRect, snapGrid, gridSize, selectedId, tool]);

  // ── Mouse handlers ───────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const w = canvasToWorld(e);
    drag.current = { startX: snap(w.x), startY: snap(w.y), dragging: true };

    if (tool === 'select') {
      // Find clicked element
      const hit = findHit(w.x, w.y);
      setSelectedId(hit);
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag.current.dragging || tool !== 'wall') return;
    const w = canvasToWorld(e);
    const ex = snap(w.x), ey = snap(w.y);
    const rx = Math.min(drag.current.startX, ex);
    const ry = Math.min(drag.current.startY, ey);
    const rw = Math.abs(ex - drag.current.startX);
    const rh = Math.abs(ey - drag.current.startY);
    if (rw > 0.1 && rh > 0.1) setDragRect({ x: rx, y: ry, w: rw, h: rh });
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag.current.dragging) return;
    drag.current.dragging = false;
    const w = canvasToWorld(e);

    if (tool === 'wall' && dragRect) {
      if (dragRect.w > 0.3 && dragRect.h > 0.3) {
        const newWall: Wall = { id: `wall-${_eid++}`, rect: { ...dragRect } };
        onChange({ ...layout, walls: [...layout.walls, newWall] });
      }
      setDragRect(null);
    } else if (tool === 'entrance') {
      const sx = snap(w.x), sy = snap(w.y);
      const en: Entrance = { id: `entrance-${_eid++}`, x: sx, y: sy, width: 3 };
      onChange({ ...layout, entrances: [...layout.entrances, en] });
    } else if (tool === 'exit') {
      const sx = snap(w.x), sy = snap(w.y);
      const ex: Exit = { id: `exit-${_eid++}`, x: sx, y: sy, width: 3, capacity: 2 };
      onChange({ ...layout, exits: [...layout.exits, ex] });
    } else if (tool === 'attractor') {
      const sx = snap(w.x), sy = snap(w.y);
      const att: Attractor = {
        id: `attractor-${_eid++}`,
        x: sx, y: sy,
        radius: 3,
        weight: attWeight,
        label: attLabel,
        serviceTime: attServiceTime,
        queueEnabled: true,
        queueCapacity: 20,
      };
      onChange({ ...layout, attractors: [...layout.attractors, att] });
    }
  };

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      onChange({
        ...layout,
        walls:      layout.walls.filter(w => w.id !== selectedId),
        entrances:  layout.entrances.filter(en => en.id !== selectedId),
        exits:      layout.exits.filter(ex => ex.id !== selectedId),
        attractors: layout.attractors.filter(att => att.id !== selectedId),
      });
      setSelectedId(null);
    }
  }, [selectedId, layout, onChange]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const findHit = (x: number, y: number): string | null => {
    for (const att of layout.attractors) {
      if (Math.hypot(att.x - x, att.y - y) < att.radius + 0.5) return att.id;
    }
    for (const en of layout.entrances) {
      if (Math.abs(en.x - x) < en.width / 2 + 0.5 && Math.abs(en.y - y) < 1) return en.id;
    }
    for (const ex of layout.exits) {
      if (Math.abs(ex.x - x) < ex.width / 2 + 0.5 && Math.abs(ex.y - y) < 1) return ex.id;
    }
    for (const w of layout.walls) {
      const r = w.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return w.id;
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {TOOLS.map(t => (
          <button
            key={t.id}
            title={t.desc}
            onClick={() => setTool(t.id)}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: tool === t.id ? `2px solid ${t.color}` : '1px solid #555',
              background: tool === t.id ? `${t.color}33` : '#2a2a3a',
              color: tool === t.id ? t.color : '#aaa',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: tool === t.id ? 'bold' : 'normal',
            }}
          >{t.label}</button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#aaa', marginLeft: 8 }}>
          <input type="checkbox" checked={snapGrid} onChange={e => setSnapGrid(e.target.checked)} />
          Snap {gridSize}m
        </label>
        <select
          value={gridSize}
          onChange={e => setGridSize(Number(e.target.value))}
          style={{ background: '#2a2a3a', color: '#aaa', border: '1px solid #555', borderRadius: 4, fontSize: 12 }}
        >
          {[1,2,5].map(v => <option key={v} value={v}>{v}m</option>)}
        </select>
      </div>

      {/* Attractor config (shown only when attractor tool selected) */}
      {tool === 'attractor' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#aaa', background: '#2a2a3a', padding: '6px 10px', borderRadius: 6 }}>
          <label>Label: <input value={attLabel} onChange={e => setAttLabel(e.target.value)} style={{ width: 80, background: '#1e1e2e', color: '#fff', border: '1px solid #555', borderRadius: 3, padding: '2px 4px' }} /></label>
          <label>Weight: <input type="number" value={attWeight} min={0} max={1} step={0.1} onChange={e => setAttWeight(Number(e.target.value))} style={{ width: 50, background: '#1e1e2e', color: '#fff', border: '1px solid #555', borderRadius: 3, padding: '2px 4px' }} /></label>
          <label>Service(s): <input type="number" value={attServiceTime} min={5} max={300} onChange={e => setAttServiceTime(Number(e.target.value))} style={{ width: 55, background: '#1e1e2e', color: '#fff', border: '1px solid #555', borderRadius: 3, padding: '2px 4px' }} /></label>
        </div>
      )}

      {selectedId && (
        <div style={{ fontSize: 11, color: '#f59e0b', padding: '4px 8px', background: '#2a2a3a', borderRadius: 4 }}>
          Selected: {selectedId} &nbsp;|&nbsp; Press <kbd style={{ background: '#3a3a4a', padding: '1px 5px', borderRadius: 3 }}>Delete</kbd> to remove
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ cursor: tool === 'select' ? 'default' : 'crosshair', border: '1px solid #3a3a4a', borderRadius: 4, display: 'block', width: '100%', aspectRatio: `${layout.width} / ${layout.height}` }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />

      <div style={{ fontSize: 11, color: '#666', textAlign: 'center' }}>
        {tool === 'wall' && 'Click + drag to draw a wall rectangle'}
        {tool === 'entrance' && 'Click to place an entrance (spawn point)'}
        {tool === 'exit' && 'Click to place an exit door'}
        {tool === 'attractor' && 'Click to place an attractor (stage / bar / toilet)'}
        {tool === 'select' && 'Click to select, Delete key to remove'}
      </div>
    </div>
  );
}
