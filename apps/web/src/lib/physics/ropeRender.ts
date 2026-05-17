import type { VerletRope } from "./ropeVerlet";

/** Catmull–Rom → cubic Bézier stroke through simulated particle positions. */
export function strokeSmoothRope(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
): void {
  const n = pts.length;
  if (n < 2) return;
  if (n === 2) {
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    ctx.lineTo(pts[1]!.x, pts[1]!.y);
    return;
  }

  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(n - 1, i + 2)]!;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

/** Render polyline from live Verlet state or snapshot particles. */
export function ropeRenderPoints(
  particles: Array<{ x: number; y: number }>,
): { x: number; y: number }[] {
  if (particles.length >= 2) return particles;
  return [];
}

export function ropeRenderPointsFromVerlet(rope: VerletRope): { x: number; y: number }[] {
  return rope.particles.map((p) => ({ x: p.x, y: p.y }));
}
