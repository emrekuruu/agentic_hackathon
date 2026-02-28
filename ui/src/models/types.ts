// ─── Core geometry ───────────────────────────────────────────────────────────

export interface Vec2 { x: number; y: number }

export interface Rect { x: number; y: number; w: number; h: number }

// ─── Venue elements ──────────────────────────────────────────────────────────

export interface Wall {
  id: string;
  rect: Rect;
}

export interface Entrance {
  id: string;
  x: number;   // metres, centre
  y: number;
  width: number; // metres
}

export interface Exit {
  id: string;
  x: number;
  y: number;
  width: number;
  capacity: number; // agents/second that can pass through
}

export interface Attractor {
  id: string;
  x: number;
  y: number;
  radius: number;
  weight: number;       // 0–1, relative probability of visiting
  label: string;
  serviceTime: number;  // seconds an agent spends here
  queueEnabled: boolean;
  queueCapacity: number;
}

export interface VenueLayout {
  width: number;   // metres
  height: number;
  walls: Wall[];
  entrances: Entrance[];
  exits: Exit[];
  attractors: Attractor[];
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export type AgentState =
  | 'seeking_attractor'
  | 'queuing'
  | 'at_attractor'
  | 'seeking_exit'
  | 'evacuating'
  | 'exited';

export interface Agent {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;          // desired walking speed, m/s
  state: AgentState;
  targetAttractorId: string | null;
  targetExitId: string | null;
  path: Vec2[];           // world-space waypoints (A* output)
  pathIndex: number;
  spawnTime: number;      // sim seconds
  exitTime: number;       // sim seconds (−1 = not yet exited)
  atAttractorUntil: number; // sim seconds
  stuckTimer: number;     // seconds velocity has been near zero
}

// ─── Simulation config ───────────────────────────────────────────────────────

export type ArrivalMode = 'burst' | 'linear' | 'gaussian';

export interface SimConfig {
  N: number;
  arrivalMode: ArrivalMode;
  arrivalDuration: number;  // minutes
  speedMin: number;
  speedMean: number;
  speedMax: number;
  personalSpace: number;    // metres – agent repulsion radius
  avoidanceStrength: number; // 0–5
  queueEnabled: boolean;
  evacuationEnabled: boolean;
  evacuationTime: number;   // minutes into sim when evacuation starts
  panicSpeedMultiplier: number;
  densityWarning: number;   // pers/m²
  densityDanger: number;
  cellSize: number;         // metres – density grid resolution
  egresTimeLimitMin: number; // p95 egress-time limit (minutes)
  warningTimeLimitPct: number; // max % sim-time above warning
  sweepStep: number;
  sweepMinN: number;
  sweepMaxN: number;
}

// ─── Metrics / frame ─────────────────────────────────────────────────────────

export interface Metrics {
  simTime: number;
  activeAgents: number;
  exitedAgents: number;
  peakDensity: number;
  currentMaxDensity: number;
  timeAboveWarning: number;  // seconds
  timeAboveDanger: number;
  avgEgressTime: number;
  p95EgressTime: number;
  queueLengths: Record<string, number>;
  maxQueueLengths: Record<string, number>;
}

export interface SimFrame {
  agents: {
    id: number; x: number; y: number;
    vx: number; vy: number; radius: number; state: AgentState;
  }[];
  densityGrid: number[][];   // [row][col] = pers/m²
  gridCols: number;
  gridRows: number;
  metrics: Metrics;
  simTime: number;
  isRunning: boolean;
  isEvacuating: boolean;
  fireGrid?: boolean[][];    // [row][col] = cell is burning (1m cells)
  fireCols?: number;
  fireRows?: number;
  firefighters?: { id: number; x: number; y: number; extinguishing: boolean; targetRow?: number; targetCol?: number }[];
  smokeGrid?: number[][];    // [row][col] = smoke intensity 0–1 (same 1m cells as fire)
  blockedExits?: string[];   // exit ids that have been sealed off
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export type EditorTool = 'select' | 'wall' | 'entrance' | 'exit' | 'attractor';

export interface EditorState {
  tool: EditorTool;
  snapToGrid: boolean;
  gridSize: number;   // metres
  selectedId: string | null;
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

export interface SweepResult {
  N: number;
  peakDensity: number;
  p95EgressTime: number;     // minutes
  timeAboveWarningPct: number;
  passed: boolean;
}

// ─── Scenario ─────────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  layout: VenueLayout;
  sweepResults: SweepResult[];  // empty = not yet analyzed
  ranAt: string | null;         // ISO timestamp of last analysis
}
