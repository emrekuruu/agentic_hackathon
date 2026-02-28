import { Vec2 } from '../models/types';

/**
 * Grid-based A* pathfinder.
 *
 * `passable[row][col] = true` means traversable.
 * Returns world-space waypoints (centre of each grid cell).
 * cellSize is in metres (world units per grid cell).
 */
export function astar(
  passable: boolean[][],
  startWorld: Vec2,
  goalWorld: Vec2,
  cellSize: number,
): Vec2[] {
  const rows = passable.length;
  if (rows === 0) return [goalWorld];
  const cols = passable[0].length;

  const toGrid = (w: Vec2) => ({
    r: Math.max(0, Math.min(rows - 1, Math.floor(w.y / cellSize))),
    c: Math.max(0, Math.min(cols - 1, Math.floor(w.x / cellSize))),
  });
  const toWorld = (r: number, c: number): Vec2 => ({
    x: (c + 0.5) * cellSize,
    y: (r + 0.5) * cellSize,
  });

  const sg = toGrid(startWorld);
  const gg = toGrid(goalWorld);

  if (!passable[sg.r]?.[sg.c]) {
    // Start in wall – return direct path
    return [goalWorld];
  }

  // If goal is in wall, find nearest passable cell to goal
  let gr = gg.r, gc = gg.c;
  if (!passable[gr]?.[gc]) {
    let best = Infinity, found = false;
    for (let dr = -3; dr <= 3 && !found; dr++) {
      for (let dc = -3; dc <= 3 && !found; dc++) {
        const nr = gr + dr, nc = gc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && passable[nr][nc]) {
          const d = dr * dr + dc * dc;
          if (d < best) { best = d; gr = nr; gc = nc; found = true; }
        }
      }
    }
  }

  // If already at goal cell, return direct path
  if (sg.r === gr && sg.c === gc) return [goalWorld];

  // ── A* ───────────────────────────────────────────────────────────────────
  const INF = 1e9;
  const gScore = new Float32Array(rows * cols).fill(INF);
  const fScore = new Float32Array(rows * cols).fill(INF);
  const cameFrom = new Int32Array(rows * cols).fill(-1);
  const idx = (r: number, c: number) => r * cols + c;

  const heuristic = (r: number, c: number) =>
    Math.sqrt((r - gr) ** 2 + (c - gc) ** 2);

  const si = idx(sg.r, sg.c);
  gScore[si] = 0;
  fScore[si] = heuristic(sg.r, sg.c);

  // Simple priority queue (min-heap by fScore)
  const open: number[] = [si];
  const inOpen = new Uint8Array(rows * cols);
  inOpen[si] = 1;

  const dirs = [
    [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
    [-1, -1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [1, 1, 1.414],
  ];

  let found = false;
  const gi = idx(gr, gc);

  while (open.length > 0) {
    // Extract min-fScore node (simple linear scan – fast enough for small grids)
    let minF = INF, minI = 0, minPos = 0;
    for (let i = 0; i < open.length; i++) {
      if (fScore[open[i]] < minF) { minF = fScore[open[i]]; minI = open[i]; minPos = i; }
    }
    open.splice(minPos, 1);

    if (minI === gi) { found = true; break; }

    const cr = Math.floor(minI / cols);
    const cc = minI % cols;

    for (const [dr, dc, cost] of dirs) {
      const nr = cr + dr, nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (!passable[nr][nc]) continue;

      const ni = idx(nr, nc);
      const tentG = gScore[minI] + cost;
      if (tentG < gScore[ni]) {
        cameFrom[ni] = minI;
        gScore[ni] = tentG;
        fScore[ni] = tentG + heuristic(nr, nc);
        if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
      }
    }
  }

  if (!found) return [goalWorld];

  // Reconstruct path
  const path: Vec2[] = [];
  let cur = gi;
  while (cur !== si) {
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    path.push(toWorld(r, c));
    cur = cameFrom[cur];
  }
  path.reverse();
  path.push(goalWorld); // exact goal position as last waypoint
  return simplifyPath(path);
}

/** Remove collinear intermediate waypoints (straight-line pruning). */
function simplifyPath(path: Vec2[]): Vec2[] {
  if (path.length <= 2) return path;
  const result: Vec2[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];
    const next = path[i + 1];
    const cross = (curr.x - prev.x) * (next.y - prev.y) -
                  (curr.y - prev.y) * (next.x - prev.x);
    if (Math.abs(cross) > 0.1) result.push(curr);
  }
  result.push(path[path.length - 1]);
  return result;
}

/**
 * Build a passable grid from venue walls.
 * `walls` is an array of { x, y, w, h } rectangles in world metres.
 */
export function buildPassableGrid(
  venueW: number,
  venueH: number,
  walls: { x: number; y: number; w: number; h: number }[],
  cellSize: number,
): boolean[][] {
  const cols = Math.ceil(venueW / cellSize);
  const rows = Math.ceil(venueH / cellSize);
  const grid: boolean[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(true),
  );

  for (const wall of walls) {
    const c0 = Math.max(0, Math.floor(wall.x / cellSize));
    const c1 = Math.min(cols - 1, Math.floor((wall.x + wall.w) / cellSize));
    const r0 = Math.max(0, Math.floor(wall.y / cellSize));
    const r1 = Math.min(rows - 1, Math.floor((wall.y + wall.h) / cellSize));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        grid[r][c] = false;
  }

  return grid;
}
