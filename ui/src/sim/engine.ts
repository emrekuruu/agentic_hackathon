/**
 * Crowd-flow simulation engine (agent-based, social-force model).
 *
 * Architecture
 * ────────────
 * • Fixed-timestep update loop driven externally via tick(dt).
 * • Agents use A* (coarse grid) for path planning + local social-force steering.
 * • SpatialHash for O(1) neighbour lookup.
 * • Density grid computed every frame for heatmap rendering.
 */

import { Agent, AgentState, Metrics, SimConfig, SimFrame, VenueLayout, Vec2 } from '../models/types';
import { v2, randNormal, gaussianCDF, closestPointOnRect, percentile } from '../utils/math';
import { SpatialHash } from '../utils/spatialHash';
import { astar, buildPassableGrid } from '../utils/astar';

// ─── Social-force constants ───────────────────────────────────────────────────
const TAU        = 0.5;   // response time (s)
const A_AGENT    = 2.0;   // repulsion magnitude (m/s²) per unit
const B_AGENT    = 0.15;  // repulsion decay distance (m)
const A_WALL     = 3.0;   // wall repulsion magnitude
const B_WALL     = 0.1;   // wall repulsion decay
const STUCK_TIME = 2.5;   // seconds before path recompute
const ASTAR_CELL = 1.0;   // A* grid resolution (metres)

let _nextId = 0;
let _ffNextId = 0;

// ─── Firefighter (internal) ───────────────────────────────────────────────────
interface Firefighter {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  path: Vec2[];
  pathIndex: number;
  targetCell: [number, number] | null; // [row, col]
  extinguishTimer: number; // counts down while extinguishing a cell
}

// ─── SimEngine ────────────────────────────────────────────────────────────────
export class SimEngine {
  private layout: VenueLayout;
  private cfg: SimConfig;

  private agents: Agent[] = [];
  private agentMap: Map<number, Agent> = new Map(); // O(1) lookup by id
  private simTime = 0;        // seconds
  private isRunning = false;
  private isEvacuating = false;

  private passable: boolean[][] = [];
  private hash: SpatialHash;

  // Metrics accumulators
  private peakDensity = 0;
  private timeAboveWarning = 0;  // seconds
  private timeAboveDanger = 0;
  private egressTimes: number[] = []; // seconds

  // Queue state: attractorId → array of agent ids
  private queues: Map<string, number[]> = new Map();
  private queueServiced: Map<string, number> = new Map(); // agents currently being served

  // Fire state
  private fireGrid: boolean[][] = [];
  private fireSpread: number[][] = []; // per-cell spread accumulator
  private smokeGrid: number[][] = []; // per-cell smoke intensity 0–1
  private fireCellCount = 0;           // O(1) "is any cell burning?" check
  private hasSmoke = false;            // O(1) "is any smoke present?" check
  private fireCols = 0;
  private fireRows = 0;
  private fireStartTime = -1;
  private readonly FIRE_SPREAD_RATE  = 0.18; // cells/second
  private readonly FIRE_REPULSION    = 10.0; // force magnitude (m/s²)
  private readonly FIRE_REP_DECAY    = 0.4;  // metres (exponential decay)
  private readonly FIRE_SEARCH_R     = 6;    // cell-radius for force query
  private readonly SMOKE_DIFFUSE     = 0.06; // fraction/second diffused per neighbour
  private readonly SMOKE_DECAY       = 0.018; // fraction/second natural dissipation

  // Blocked exits (scenario planning)
  private blockedExits: Set<string> = new Set();

  // Firefighter state
  private firefighters: Firefighter[] = [];
  private firefightersSpawned = false;
  private readonly FF_RESPONSE_DELAY = 30;  // seconds after fire detected
  private readonly FF_COUNT          = 3;
  private readonly FF_SPEED          = 1.6; // m/s
  private readonly FF_EXTINGUISH_T   = 1.5; // seconds per cell

  // Spawn accounting
  private spawnedCount = 0;
  private totalToSpawn = 0;
  private entranceWeights: number[] = [];

  constructor(layout: VenueLayout, cfg: SimConfig) {
    this.layout = layout;
    this.cfg = cfg;
    this.hash = new SpatialHash(cfg.personalSpace * 2);
    this.rebuild();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  updateConfig(cfg: SimConfig): void {
    this.cfg = cfg;
  }

  updateLayout(layout: VenueLayout): void {
    this.layout = layout;
    this.rebuild();
  }

  reset(): void {
    this.agents = [];
    this.agentMap.clear();
    this.simTime = 0;
    this.isRunning = false;
    this.isEvacuating = false;
    this.peakDensity = 0;
    this.timeAboveWarning = 0;
    this.timeAboveDanger = 0;
    this.egressTimes = [];
    this.spawnedCount = 0;
    this.queues.clear();
    this.queueServiced.clear();
    this.blockedExits.clear();
    _nextId = 0;
    this.totalToSpawn = this.cfg.N;
    this.rebuild();
    this.clearFire();
    this.firefighters = [];
    this.firefightersSpawned = false;
    this.fireStartTime = -1;
    _ffNextId = 0;
  }

  startFire(wx: number, wy: number): void {
    const c = Math.floor(wx);
    const r = Math.floor(wy);
    if (r >= 0 && r < this.fireRows && c >= 0 && c < this.fireCols && this.passable[r][c]) {
      if (!this.fireGrid[r][c]) { this.fireGrid[r][c] = true; this.fireCellCount++; }
      if (this.fireStartTime < 0) this.fireStartTime = this.simTime;
      if (!this.isEvacuating) this.triggerEvacuation();
    }
  }

  setBlockedExits(ids: Set<string>): void {
    this.blockedExits = new Set(ids);
    // Re-route agents whose target exit just became blocked
    for (const a of this.agents) {
      if ((a.state === 'seeking_exit' || a.state === 'evacuating') &&
          a.targetExitId && this.blockedExits.has(a.targetExitId)) {
        a.targetExitId = null;
        this.computePath(a);
      }
    }
  }

  start(): void  { this.isRunning = true; }
  pause(): void  { this.isRunning = false; }
  get running()  { return this.isRunning; }
  get time()     { return this.simTime; }

  /** Advance simulation by dt seconds. */
  tick(dt: number): void {
    if (!this.isRunning) return;
    const { cfg } = this;

    // Clamp dt to avoid instability
    dt = Math.min(dt, 0.05);

    // Check evacuation trigger
    if (cfg.evacuationEnabled && !this.isEvacuating &&
        this.simTime >= cfg.evacuationTime * 60) {
      this.triggerEvacuation();
    }

    // Spread fire + smoke + tick firefighters
    if (this.fireCellCount > 0) {
      this.spreadFire(dt);
      this.spreadSmoke(dt);
    } else if (this.hasSmoke) {
      this.spreadSmoke(dt); // smoke lingers and decays even after fire goes out
    }
    this.tickFirefighters(dt);

    // Spawn agents
    this.spawnAgents(dt);

    // Build spatial hash
    this.hash.clear();
    for (const a of this.agents) {
      if (a.state !== 'exited') this.hash.insert(a.id, a.x, a.y);
    }

    // Update each agent
    for (const a of this.agents) {
      if (a.state === 'exited') continue;
      this.updateAgent(a, dt);
    }

    // Process queues
    this.processQueues(dt);

    // Density metrics
    const grid = this.computeDensityGrid();
    const maxDensity = this.maxOfGrid(grid);
    if (maxDensity > this.peakDensity) this.peakDensity = maxDensity;
    if (maxDensity > cfg.densityWarning) this.timeAboveWarning += dt;
    if (maxDensity > cfg.densityDanger)  this.timeAboveDanger  += dt;

    this.simTime += dt;
  }

  getFrame(): SimFrame {
    const grid = this.computeDensityGrid();
    const gridRows = grid.length;
    const gridCols = gridRows > 0 ? grid[0].length : 0;
    return {
      agents: this.agents
        .filter(a => a.state !== 'exited')
        .map(a => ({ id: a.id, x: a.x, y: a.y, vx: a.vx, vy: a.vy, radius: a.radius, state: a.state })),
      densityGrid: grid,
      gridCols,
      gridRows,
      metrics: this.getMetrics(),
      simTime: this.simTime,
      isRunning: this.isRunning,
      isEvacuating: this.isEvacuating,
      fireGrid: this.fireGrid,
      fireCols: this.fireCols,
      fireRows: this.fireRows,
      firefighters: this.firefighters.map(ff => ({
        id: ff.id, x: ff.x, y: ff.y, extinguishing: ff.extinguishTimer > 0,
        targetRow: ff.targetCell?.[0], targetCol: ff.targetCell?.[1],
      })),
      smokeGrid: this.smokeGrid,
      blockedExits: [...this.blockedExits],
    };
  }

  getMetrics(): Metrics {
    const queueLengths: Record<string, number> = {};
    const maxQueueLengths: Record<string, number> = {};
    for (const [id, q] of this.queues) {
      queueLengths[id] = q.length;
      maxQueueLengths[id] = q.length; // running max tracked separately
    }
    const sorted = [...this.egressTimes].sort((a, b) => a - b);
    return {
      simTime: this.simTime,
      activeAgents: this.agents.filter(a => a.state !== 'exited').length,
      exitedAgents: this.egressTimes.length,
      peakDensity: this.peakDensity,
      currentMaxDensity: this.maxOfGrid(this.computeDensityGrid()),
      timeAboveWarning: this.timeAboveWarning,
      timeAboveDanger: this.timeAboveDanger,
      avgEgressTime: sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0,
      p95EgressTime: percentile(sorted, 95),
      queueLengths,
      maxQueueLengths,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private rebuild(): void {
    const { layout, cfg } = this;
    this.passable = buildPassableGrid(layout.width, layout.height,
      layout.walls.map(w => w.rect), ASTAR_CELL);

    // Initialise fire grid (same resolution as passable grid: 1m cells)
    this.fireRows = this.passable.length;
    this.fireCols = this.passable[0]?.length ?? 0;
    this.clearFire();

    // Compute entrance weights (equal for now)
    const n = layout.entrances.length;
    this.entranceWeights = n > 0 ? layout.entrances.map(() => 1 / n) : [];

    // Init queues for attractors
    this.queues.clear();
    this.queueServiced.clear();
    for (const att of layout.attractors) {
      this.queues.set(att.id, []);
      this.queueServiced.set(att.id, 0);
    }
  }

  private clearFire(): void {
    this.fireGrid   = Array.from({ length: this.fireRows }, () => new Array(this.fireCols).fill(false));
    this.fireSpread = Array.from({ length: this.fireRows }, () => new Array(this.fireCols).fill(0));
    this.smokeGrid  = Array.from({ length: this.fireRows }, () => new Array(this.fireCols).fill(0));
    this.fireCellCount = 0;
    this.hasSmoke = false;
  }

  private spreadSmoke(dt: number): void {
    const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const next: number[][] = this.smokeGrid.map(row => [...row]);
    for (let r = 0; r < this.fireRows; r++) {
      for (let c = 0; c < this.fireCols; c++) {
        // Fire cells are always max smoke
        if (this.fireGrid[r][c]) { next[r][c] = 1.0; continue; }
        // Diffuse from neighbours
        let inflow = 0;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < this.fireRows && nc >= 0 && nc < this.fireCols) {
            inflow += this.smokeGrid[nr][nc] * this.SMOKE_DIFFUSE * dt;
          }
        }
        next[r][c] = Math.min(1, this.smokeGrid[r][c] + inflow) * (1 - this.SMOKE_DECAY * dt);
      }
    }
    this.smokeGrid = next;
    this.hasSmoke = next.some(row => row.some(v => v > 0.01));
  }

  private spreadFire(dt: number): void {
    const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const ignite: [number, number][] = [];
    for (let r = 0; r < this.fireRows; r++) {
      for (let c = 0; c < this.fireCols; c++) {
        if (!this.fireGrid[r][c]) continue;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= this.fireRows || nc < 0 || nc >= this.fireCols) continue;
          if (this.fireGrid[nr][nc] || !this.passable[nr][nc]) continue;
          this.fireSpread[nr][nc] += dt * this.FIRE_SPREAD_RATE;
          if (this.fireSpread[nr][nc] >= 1) {
            ignite.push([nr, nc]);
            this.fireSpread[nr][nc] = 0;
          }
        }
      }
    }
    for (const [r, c] of ignite) { this.fireGrid[r][c] = true; this.fireCellCount++; }
  }

  private tickFirefighters(dt: number): void {
    // Spawn after response delay
    if (!this.firefightersSpawned && this.fireStartTime >= 0 &&
        this.simTime - this.fireStartTime >= this.FF_RESPONSE_DELAY) {
      this.spawnFirefighters();
      this.firefightersSpawned = true;
    }

    for (const ff of this.firefighters) {
      // Extinguishing phase: stand still, count down
      if (ff.extinguishTimer > 0) {
        ff.extinguishTimer -= dt;
        ff.vx *= 0.8; ff.vy *= 0.8;
        if (ff.extinguishTimer <= 0 && ff.targetCell) {
          const [r, c] = ff.targetCell;
          // Extinguish target cell
          if (this.fireGrid[r]?.[c]) {
            this.fireGrid[r][c] = false;
            this.fireCellCount--;
            this.fireSpread[r][c] = 0;
          }
          // Water suppresses neighbours: clear spread progress and extinguish
          // cells that haven't fully ignited yet (spread < 0.6)
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr, nc = c + dc;
              if (nr < 0 || nr >= this.fireRows || nc < 0 || nc >= this.fireCols) continue;
              if (this.fireGrid[nr][nc]) {
                // Young cell: extinguish entirely; mature cell: just slow spread
                if (this.fireSpread[nr][nc] < 0.6) {
                  this.fireGrid[nr][nc] = false;
                  this.fireCellCount--;
                }
              }
              this.fireSpread[nr][nc] = 0;
            }
          }
          ff.targetCell = null;
        }
        continue;
      }

      // Find nearest burning cell if no valid target
      const [tr, tc] = ff.targetCell ?? [-1, -1];
      if (!ff.targetCell || !this.fireGrid[tr]?.[tc]) {
        const cell = this.findNearestFireCell(ff.x, ff.y);
        if (!cell) { ff.vx *= 0.9; ff.vy *= 0.9; continue; } // all out
        ff.targetCell = cell;
        ff.path = astar(this.passable,
          { x: ff.x, y: ff.y },
          { x: cell[1] + 0.5, y: cell[0] + 0.5 },
          ASTAR_CELL,
        );
        ff.pathIndex = 0;
      }

      // Path end → start extinguishing
      if (ff.pathIndex >= ff.path.length) {
        ff.vx *= 0.5; ff.vy *= 0.5;
        if (ff.targetCell) ff.extinguishTimer = this.FF_EXTINGUISH_T;
        continue;
      }

      // Move along path
      const wp = ff.path[ff.pathIndex];
      const dx = wp.x - ff.x, dy = wp.y - ff.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.6) {
        ff.pathIndex++;
      } else {
        const ax = ((dx / dist) * this.FF_SPEED - ff.vx) / 0.3;
        const ay = ((dy / dist) * this.FF_SPEED - ff.vy) / 0.3;
        ff.vx += ax * dt;
        ff.vy += ay * dt;
        const spd = Math.sqrt(ff.vx ** 2 + ff.vy ** 2);
        if (spd > this.FF_SPEED) { ff.vx *= this.FF_SPEED / spd; ff.vy *= this.FF_SPEED / spd; }
      }
      ff.x += ff.vx * dt;
      ff.y += ff.vy * dt;
      ff.x = v2.clamp(ff.x, 0.5, this.layout.width  - 0.5);
      ff.y = v2.clamp(ff.y, 0.5, this.layout.height - 0.5);
      // Basic wall push-out (same logic as resolveWallCollisions, radius 0.3)
      for (const wall of this.layout.walls) {
        const wr = wall.rect;
        const R = 0.3;
        if (ff.x + R > wr.x && ff.x - R < wr.x + wr.w &&
            ff.y + R > wr.y && ff.y - R < wr.y + wr.h) {
          const oL = (ff.x + R) - wr.x, oR = (wr.x + wr.w) - (ff.x - R);
          const oT = (ff.y + R) - wr.y, oB = (wr.y + wr.h) - (ff.y - R);
          const m = Math.min(oL, oR, oT, oB);
          if (m === oL)      { ff.x -= oL; ff.vx = Math.min(0, ff.vx); }
          else if (m === oR) { ff.x += oR; ff.vx = Math.max(0, ff.vx); }
          else if (m === oT) { ff.y -= oT; ff.vy = Math.min(0, ff.vy); }
          else               { ff.y += oB; ff.vy = Math.max(0, ff.vy); }
        }
      }
    }
  }

  private spawnFirefighters(): void {
    const { layout } = this;
    if (layout.entrances.length === 0) return;
    for (let i = 0; i < this.FF_COUNT; i++) {
      const ent = layout.entrances[i % layout.entrances.length];
      this.firefighters.push({
        id: _ffNextId++,
        x: ent.x + (Math.random() - 0.5) * ent.width * 0.5,
        y: ent.y,
        vx: 0, vy: 0,
        path: [], pathIndex: 0,
        targetCell: null,
        extinguishTimer: 0,
      });
    }
  }

  private findNearestFireCell(x: number, y: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestD2 = Infinity;
    for (let r = 0; r < this.fireRows; r++) {
      for (let c = 0; c < this.fireCols; c++) {
        if (!this.fireGrid[r][c]) continue;
        const d2 = (x - (c + 0.5)) ** 2 + (y - (r + 0.5)) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = [r, c]; }
      }
    }
    return best;
  }

  private spawnAgents(dt: number): void {
    const { cfg, layout } = this;
    if (this.spawnedCount >= cfg.N || layout.entrances.length === 0) return;

    const durationSec = cfg.arrivalDuration * 60;
    let targetFraction: number;

    switch (cfg.arrivalMode) {
      case 'burst':
        targetFraction = this.simTime < 5 ? 1 : 1;  // spawn everyone in first 5s
        break;
      case 'linear':
        targetFraction = Math.min(1, this.simTime / durationSec);
        break;
      case 'gaussian': {
        const mu = durationSec * 0.5;
        const sigma = durationSec * 0.2;
        targetFraction = gaussianCDF(this.simTime, mu, sigma);
        break;
      }
    }

    const targetCount = Math.floor(targetFraction * cfg.N);
    const toSpawn = Math.max(0, targetCount - this.spawnedCount);

    for (let i = 0; i < toSpawn && this.spawnedCount < cfg.N; i++) {
      this.spawnOneAgent();
    }
  }

  private spawnOneAgent(): void {
    const { cfg, layout } = this;
    // Pick a random entrance
    const entrance = layout.entrances[Math.floor(Math.random() * layout.entrances.length)];
    const x = entrance.x + (Math.random() - 0.5) * entrance.width * 0.8;
    const y = entrance.y + (Math.random() - 0.5) * 0.5;

    // Pick speed (clamped normal distribution)
    const speed = v2.clamp(
      randNormal(cfg.speedMean, (cfg.speedMax - cfg.speedMin) / 4),
      cfg.speedMin, cfg.speedMax,
    );

    // Pick target attractor (weighted random, or null)
    const targetAttractorId = this.pickAttractor();

    const agent: Agent = {
      id: _nextId++,
      x, y,
      vx: 0, vy: 0,
      radius: 0.22 + Math.random() * 0.06, // 0.22–0.28 m
      speed,
      state: targetAttractorId ? 'seeking_attractor' : 'seeking_exit',
      targetAttractorId,
      targetExitId: null,
      path: [],
      pathIndex: 0,
      spawnTime: this.simTime,
      exitTime: -1,
      atAttractorUntil: -1,
      stuckTimer: 0,
    };

    // Compute initial path
    this.computePath(agent);

    this.agents.push(agent);
    this.agentMap.set(agent.id, agent);
    this.spawnedCount++;
  }

  private pickAttractor(): string | null {
    const { layout, cfg } = this;
    if (layout.attractors.length === 0) return null;
    if (this.isEvacuating) return null;

    const totalWeight = layout.attractors.reduce((s, a) => s + a.weight, 0);
    if (totalWeight === 0) return null;

    const r = Math.random() * totalWeight;
    let acc = 0;
    for (const att of layout.attractors) {
      acc += att.weight;
      if (r <= acc) {
        // Check queue capacity
        if (cfg.queueEnabled && att.queueEnabled) {
          const q = this.queues.get(att.id) ?? [];
          const served = this.queueServiced.get(att.id) ?? 0;
          if (q.length + served >= att.queueCapacity) continue; // full, skip
        }
        return att.id;
      }
    }
    return null;
  }

  private pickExit(): string | null {
    const { layout } = this;
    if (layout.exits.length === 0) return null;
    return layout.exits[Math.floor(Math.random() * layout.exits.length)].id;
  }

  private computePath(agent: Agent): void {
    const { layout } = this;
    let goal: Vec2;

    if (agent.state === 'seeking_attractor' && agent.targetAttractorId) {
      const att = layout.attractors.find(a => a.id === agent.targetAttractorId);
      goal = att ? { x: att.x, y: att.y } : this.nearestExitPos(agent);
    } else {
      goal = this.nearestExitPos(agent);
    }

    agent.path = astar(this.passable, { x: agent.x, y: agent.y }, goal, ASTAR_CELL);
    agent.pathIndex = 0;
  }

  private nearestExitPos(agent: Agent): Vec2 {
    const { layout } = this;
    if (layout.exits.length === 0) return { x: layout.width / 2, y: layout.height / 2 };
    // Prefer open exits; fall back to all exits if every exit is blocked
    const candidates = layout.exits.filter(ex => !this.blockedExits.has(ex.id));
    const pool = candidates.length > 0 ? candidates : layout.exits;
    let best = pool[0];
    let bestD = v2.dist2({ x: agent.x, y: agent.y }, { x: best.x, y: best.y });
    for (const ex of pool) {
      const d = v2.dist2({ x: agent.x, y: agent.y }, { x: ex.x, y: ex.y });
      if (d < bestD) { bestD = d; best = ex; }
    }
    agent.targetExitId = best.id;
    return { x: best.x, y: best.y };
  }

  private triggerEvacuation(): void {
    this.isEvacuating = true;
    for (const a of this.agents) {
      if (a.state === 'exited') continue;
      if (a.state === 'at_attractor' || a.state === 'seeking_attractor' || a.state === 'queuing') {
        // Remove from queue if present
        for (const [, q] of this.queues) {
          const idx = q.indexOf(a.id);
          if (idx >= 0) q.splice(idx, 1);
        }
        a.state = 'evacuating';
        a.targetAttractorId = null;
        this.computePath(a);
      }
      // Boost speed
      a.speed *= this.cfg.panicSpeedMultiplier;
    }
  }

  private updateAgent(agent: Agent, dt: number): void {
    if (agent.state === 'at_attractor') {
      if (this.simTime >= agent.atAttractorUntil) {
        // Done at attractor – head for exit
        const aId = agent.targetAttractorId;
        if (aId) this.queueServiced.set(aId, Math.max(0, (this.queueServiced.get(aId) ?? 1) - 1));
        agent.state = 'seeking_exit';
        agent.targetAttractorId = null;
        this.computePath(agent);
      }
      return;
    }

    if (agent.state === 'queuing') {
      // Stationary – managed by processQueues
      agent.vx *= 0.8;
      agent.vy *= 0.8;
      return;
    }

    // ── Determine desired velocity toward next waypoint ─────────────────────
    const waypoint = this.currentWaypoint(agent);
    if (!waypoint) {
      // No waypoint – try to exit
      agent.state = this.isEvacuating ? 'evacuating' : 'seeking_exit';
      this.computePath(agent);
      return;
    }

    const dx = waypoint.x - agent.x;
    const dy = waypoint.y - agent.y;
    const distToWP = Math.sqrt(dx * dx + dy * dy);

    // Advance waypoint if close enough
    if (distToWP < 0.6) {
      agent.pathIndex++;
      if (agent.pathIndex >= agent.path.length) {
        // Reached end of path
        this.onAgentReachedTarget(agent);
        return;
      }
    }

    const desiredDir = distToWP > 1e-6
      ? { x: dx / distToWP, y: dy / distToWP }
      : { x: 0, y: 0 };

    // Smoke slows agents (heavy smoke → up to 65% speed reduction)
    let smokeFactor = 1.0;
    if (this.smokeGrid.length > 0) {
      const sr = Math.floor(agent.y), sc = Math.floor(agent.x);
      if (sr >= 0 && sr < this.fireRows && sc >= 0 && sc < this.fireCols) {
        const s = this.smokeGrid[sr][sc];
        if (s > 0.15) smokeFactor = Math.max(0.35, 1 - s * 0.65);
      }
    }

    const desiredVx = desiredDir.x * agent.speed * smokeFactor;
    const desiredVy = desiredDir.y * agent.speed * smokeFactor;

    // ── Social forces ────────────────────────────────────────────────────────
    let fx = (desiredVx - agent.vx) / TAU;
    let fy = (desiredVy - agent.vy) / TAU;

    // Agent–agent repulsion
    const neighbours = this.hash.query(agent.x, agent.y, agent.radius * 6 + 1.5);
    const avoidance = this.cfg.avoidanceStrength;

    for (const nid of neighbours) {
      if (nid === agent.id) continue;
      const nb = this.agentById(nid);
      if (!nb || nb.state === 'exited') continue;

      const ddx = agent.x - nb.x;
      const ddy = agent.y - nb.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const minDist = agent.radius + nb.radius;
      if (dist < 1e-6) continue;

      const overlap = minDist - dist;
      if (overlap > -this.cfg.personalSpace * 2) {
        const strength = A_AGENT * avoidance * Math.exp(overlap / B_AGENT);
        fx += strength * (ddx / dist);
        fy += strength * (ddy / dist);
      }
    }

    // Wall repulsion
    for (const wall of this.layout.walls) {
      const { cx, cy, dist2 } = closestPointOnRect(
        agent.x, agent.y, wall.rect.x, wall.rect.y, wall.rect.w, wall.rect.h,
      );
      const dist = Math.sqrt(dist2);
      if (dist < 1.5 && dist > 1e-6) {
        const strength = A_WALL * Math.exp((agent.radius - dist) / B_WALL);
        fx += strength * (agent.x - cx) / dist;
        fy += strength * (agent.y - cy) / dist;
      }
    }

    // Fire repulsion
    if (this.fireRows > 0) {
      const fr = Math.floor(agent.y);
      const fc = Math.floor(agent.x);
      for (let dr = -this.FIRE_SEARCH_R; dr <= this.FIRE_SEARCH_R; dr++) {
        for (let dc = -this.FIRE_SEARCH_R; dc <= this.FIRE_SEARCH_R; dc++) {
          const nr = fr + dr, nc = fc + dc;
          if (nr < 0 || nr >= this.fireRows || nc < 0 || nc >= this.fireCols) continue;
          if (!this.fireGrid[nr][nc]) continue;
          const cx = nc + 0.5, cy = nr + 0.5;
          const ddx = agent.x - cx, ddy = agent.y - cy;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist < 0.01) continue;
          const str = this.FIRE_REPULSION * Math.exp(-dist / this.FIRE_REP_DECAY);
          fx += (ddx / dist) * str;
          fy += (ddy / dist) * str;
        }
      }
    }

    // ── Integrate ────────────────────────────────────────────────────────────
    agent.vx += fx * dt;
    agent.vy += fy * dt;

    // Clamp speed
    const speed = Math.sqrt(agent.vx ** 2 + agent.vy ** 2);
    const maxSpeed = agent.speed * 1.5;
    if (speed > maxSpeed) {
      agent.vx = (agent.vx / speed) * maxSpeed;
      agent.vy = (agent.vy / speed) * maxSpeed;
    }

    agent.x += agent.vx * dt;
    agent.y += agent.vy * dt;

    // Clamp to venue bounds
    agent.x = v2.clamp(agent.x, agent.radius, this.layout.width  - agent.radius);
    agent.y = v2.clamp(agent.y, agent.radius, this.layout.height - agent.radius);

    // Wall penetration resolution (push out)
    this.resolveWallCollisions(agent);

    // Stuck detection
    if (speed < 0.05) {
      agent.stuckTimer += dt;
      if (agent.stuckTimer > STUCK_TIME) {
        agent.stuckTimer = 0;
        this.computePath(agent);
      }
    } else {
      agent.stuckTimer = 0;
    }

    // Check arrival at exit
    this.checkExitArrival(agent);
  }

  private resolveWallCollisions(agent: Agent): void {
    for (const wall of this.layout.walls) {
      const r = wall.rect;
      if (agent.x + agent.radius > r.x && agent.x - agent.radius < r.x + r.w &&
          agent.y + agent.radius > r.y && agent.y - agent.radius < r.y + r.h) {
        // Agent overlaps wall – push out along shortest axis
        const overlapL = (agent.x + agent.radius) - r.x;
        const overlapR = (r.x + r.w) - (agent.x - agent.radius);
        const overlapT = (agent.y + agent.radius) - r.y;
        const overlapB = (r.y + r.h) - (agent.y - agent.radius);
        const minOv = Math.min(overlapL, overlapR, overlapT, overlapB);
        if (minOv === overlapL)      { agent.x -= overlapL; agent.vx = Math.min(0, agent.vx); }
        else if (minOv === overlapR) { agent.x += overlapR; agent.vx = Math.max(0, agent.vx); }
        else if (minOv === overlapT) { agent.y -= overlapT; agent.vy = Math.min(0, agent.vy); }
        else                         { agent.y += overlapB; agent.vy = Math.max(0, agent.vy); }
      }
    }
  }

  private checkExitArrival(agent: Agent): void {
    if (agent.state !== 'seeking_exit' && agent.state !== 'evacuating') return;
    for (const exit of this.layout.exits) {
      if (this.blockedExits.has(exit.id)) continue; // sealed exit — can't use
      const d = v2.dist({ x: agent.x, y: agent.y }, { x: exit.x, y: exit.y });
      if (d < exit.width / 2 + agent.radius + 0.3) {
        agent.state = 'exited';
        agent.exitTime = this.simTime;
        this.egressTimes.push(agent.exitTime - agent.spawnTime);
        return;
      }
    }
  }

  private onAgentReachedTarget(agent: Agent): void {
    if (agent.state === 'seeking_attractor' && agent.targetAttractorId) {
      const att = this.layout.attractors.find(a => a.id === agent.targetAttractorId);
      if (!att) { agent.state = 'seeking_exit'; this.computePath(agent); return; }

      if (this.cfg.queueEnabled && att.queueEnabled) {
        // Join queue
        const q = this.queues.get(att.id) ?? [];
        if (q.indexOf(agent.id) < 0) q.push(agent.id);
        this.queues.set(att.id, q);
        agent.state = 'queuing';
      } else {
        // Serve immediately
        agent.state = 'at_attractor';
        agent.atAttractorUntil = this.simTime + att.serviceTime;
        this.queueServiced.set(att.id, (this.queueServiced.get(att.id) ?? 0) + 1);
      }
    } else {
      // Reached exit area – look for actual exit
      agent.state = 'seeking_exit';
      this.computePath(agent);
    }
  }

  private processQueues(dt: number): void {
    for (const att of this.layout.attractors) {
      if (!att.queueEnabled || !this.cfg.queueEnabled) continue;
      const q = this.queues.get(att.id);
      if (!q || q.length === 0) continue;

      const served = this.queueServiced.get(att.id) ?? 0;
      // Serve next agent if slot available (capacity = 1 concurrent server for now)
      if (served < 1) {
        const nextId = q.shift()!;
        const agent = this.agentById(nextId);
        if (agent) {
          agent.state = 'at_attractor';
          agent.atAttractorUntil = this.simTime + att.serviceTime;
          this.queueServiced.set(att.id, served + 1);
        }
      }
    }
  }

  private currentWaypoint(agent: Agent): Vec2 | null {
    if (agent.pathIndex >= agent.path.length) return null;
    return agent.path[agent.pathIndex];
  }

  private agentById(id: number): Agent | undefined {
    return this.agentMap.get(id);
  }

  computeDensityGrid(): number[][] {
    const { layout, cfg } = this;
    const cols = Math.ceil(layout.width  / cfg.cellSize);
    const rows = Math.ceil(layout.height / cfg.cellSize);
    const grid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (const a of this.agents) {
      if (a.state === 'exited') continue;
      const c = Math.floor(a.x / cfg.cellSize);
      const r = Math.floor(a.y / cfg.cellSize);
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        grid[r][c] += 1 / (cfg.cellSize * cfg.cellSize); // pers/m²
      }
    }
    return grid;
  }

  private maxOfGrid(grid: number[][]): number {
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    return max;
  }
}

// ─── Sweep runner ─────────────────────────────────────────────────────────────
/**
 * Runs abbreviated simulations for a range of N values and returns
 * peak density + p95 egress time for each.
 *
 * Uses a faster tick rate (larger dt) and shorter simulation window.
 */
import { SweepResult } from '../models/types';

export function runSweep(
  layout: VenueLayout,
  baseCfg: SimConfig,
  onProgress: (done: number, total: number) => void,
): SweepResult[] {
  const results: SweepResult[] = [];
  const step = baseCfg.sweepStep;
  const values: number[] = [];
  for (let n = baseCfg.sweepMinN; n <= baseCfg.sweepMaxN; n += step) values.push(n);

  for (let vi = 0; vi < values.length; vi++) {
    const N = values[vi];
    const cfg: SimConfig = {
      ...baseCfg,
      N,
      evacuationEnabled: true,
      evacuationTime: baseCfg.arrivalDuration + 2, // evacuate shortly after arrival
    };

    const engine = new SimEngine(layout, cfg);
    engine.reset();
    engine.start();

    // Run for arrivalDuration + evacuation + extra buffer.
    // DT must match tick()'s internal clamp (0.05) so sim-time advances correctly.
    const simDuration = (baseCfg.arrivalDuration + 10) * 60; // seconds
    const DT = 0.05;
    const evacuationSec = cfg.evacuationTime * 60;

    for (let t = 0; t < simDuration; t += DT) {
      engine.tick(DT);
      // Early-exit once everyone has evacuated (saves ~50% of loop iterations)
      if (t > evacuationSec + 60 && engine.getMetrics().activeAgents === 0) break;
    }

    const m = engine.getMetrics();
    const simTime = engine.time;
    const timeAboveWarningPct = simTime > 0
      ? (m.timeAboveWarning / simTime) * 100
      : 0;

    const passed =
      m.peakDensity <= baseCfg.densityDanger &&
      m.p95EgressTime / 60 <= baseCfg.egresTimeLimitMin &&
      timeAboveWarningPct <= baseCfg.warningTimeLimitPct;

    results.push({
      N,
      peakDensity: m.peakDensity,
      p95EgressTime: m.p95EgressTime / 60, // minutes
      timeAboveWarningPct,
      passed,
    });

    onProgress(vi + 1, values.length);
  }

  return results;
}
