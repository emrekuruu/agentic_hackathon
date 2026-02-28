/**
 * Uniform-grid spatial hash for fast neighbour queries.
 * IDs are arbitrary non-negative integers (agent indices).
 */
export class SpatialHash {
  private cells = new Map<number, number[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    // Cantor-style pairing – works for reasonable grid sizes
    return cx * 100003 + cy;
  }

  private cellOf(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  clear(): void {
    this.cells.clear();
  }

  insert(id: number, x: number, y: number): void {
    const k = this.key(this.cellOf(x), this.cellOf(y));
    let list = this.cells.get(k);
    if (!list) { list = []; this.cells.set(k, list); }
    list.push(id);
  }

  /** Returns all IDs within (world-space) `radius` of (x, y). */
  query(x: number, y: number, radius: number): number[] {
    const result: number[] = [];
    const r = Math.ceil(radius / this.cellSize);
    const cx0 = this.cellOf(x) - r;
    const cx1 = this.cellOf(x) + r;
    const cy0 = this.cellOf(y) - r;
    const cy1 = this.cellOf(y) + r;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) {
          for (const id of list) result.push(id);
        }
      }
    }
    return result;
  }
}
