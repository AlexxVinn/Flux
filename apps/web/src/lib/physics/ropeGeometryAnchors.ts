/** Collision radius for an anchor body (circle or rectangle). */
export function anchorCollisionRadius(
  width: number,
  height: number,
  shape: "circle" | "rectangle",
): number {
  if (shape === "circle") return width / 2;
  return Math.hypot(width, height) / 2;
}

/** World point on anchor surface facing the other body. */
export function anchorSurfaceWorld(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  radius: number,
  towardOther: boolean,
): { x: number; y: number } {
  const sign = towardOther ? 1 : -1;
  return { x: cx + ux * radius * sign, y: cy + uy * radius * sign };
}
