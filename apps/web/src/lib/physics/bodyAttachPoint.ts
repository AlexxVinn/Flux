import { angleSnapOriginXY, snapWorldPointToAngle, type AttachSnapOptions } from "./attachSnap";
import type { BodyShape, SimBodySnapshot } from "./types";

export interface AttachPoint {
  worldX: number;
  worldY: number;
  /** Attachment offset in the body's local space (Matter constraint point). */
  localX: number;
  localY: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function localToWorld(
  cx: number,
  cy: number,
  angle: number,
  lx: number,
  ly: number,
): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
}

export function worldToLocal(
  cx: number,
  cy: number,
  angle: number,
  wx: number,
  wy: number,
): { x: number; y: number } {
  let dx = wx - cx;
  let dy = wy - cy;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

function comSnapThreshold(hw: number, hh: number): number {
  return Math.max(10, Math.min(hw, hh) * 0.22);
}

function closestOnCircleBoundary(lx: number, ly: number, r: number): { x: number; y: number } {
  const d = Math.hypot(lx, ly);
  if (d < 1e-6) return { x: r, y: 0 };
  return { x: (lx / d) * r, y: (ly / d) * r };
}

function closestOnRectBoundary(
  lx: number,
  ly: number,
  hw: number,
  hh: number,
): { x: number; y: number } {
  const cx = clamp(lx, -hw, hw);
  const cy = clamp(ly, -hh, hh);
  const penL = cx + hw;
  const penR = hw - cx;
  const penT = cy + hh;
  const penB = hh - cy;
  const minPen = Math.min(penL, penR, penT, penB);
  if (minPen === penL) return { x: -hw, y: cy };
  if (minPen === penR) return { x: hw, y: cy };
  if (minPen === penT) return { x: cx, y: -hh };
  return { x: cx, y: hh };
}

function resolveLocalAttach(
  lx: number,
  ly: number,
  shape: BodyShape,
  hw: number,
  hh: number,
  snap: boolean,
): { x: number; y: number } {
  if (shape === "circle") {
    const r = hw;
    if (snap) {
      if (Math.hypot(lx, ly) <= comSnapThreshold(r, r)) return { x: 0, y: 0 };
      return closestOnCircleBoundary(lx, ly, r);
    }
    const d = Math.hypot(lx, ly);
    if (d > r) return closestOnCircleBoundary(lx, ly, r);
    return { x: lx, y: ly };
  }

  if (snap) {
    if (Math.hypot(lx, ly) <= comSnapThreshold(hw, hh)) return { x: 0, y: 0 };
    return closestOnRectBoundary(lx, ly, hw, hh);
  }

  const inside = Math.abs(lx) <= hw && Math.abs(ly) <= hh;
  if (inside) return { x: lx, y: ly };
  return closestOnRectBoundary(lx, ly, hw, hh);
}

export function attachPointFromBody(
  body: Pick<SimBodySnapshot, "x" | "y" | "angle" | "width" | "height" | "shape">,
  worldX: number,
  worldY: number,
  snap: boolean,
): AttachPoint {
  const hw = body.width / 2;
  const hh = body.height / 2;
  const local = worldToLocal(body.x, body.y, body.angle, worldX, worldY);
  const resolved = resolveLocalAttach(local.x, local.y, body.shape, hw, hh, snap);
  const world = localToWorld(body.x, body.y, body.angle, resolved.x, resolved.y);
  return {
    worldX: world.x,
    worldY: world.y,
    localX: resolved.x,
    localY: resolved.y,
  };
}

/** Angle snap (Shift) then body COM / edge snap. */
export function resolveAttachPoint(
  body: Pick<SimBodySnapshot, "x" | "y" | "angle" | "width" | "height" | "shape">,
  worldX: number,
  worldY: number,
  options: AttachSnapOptions,
): AttachPoint {
  let wx = worldX;
  let wy = worldY;
  if (options.angleSnap && options.angleSnapOrigin) {
    const o = angleSnapOriginXY(options.angleSnapOrigin);
    const snapped = snapWorldPointToAngle(o.x, o.y, wx, wy, true);
    wx = snapped.x;
    wy = snapped.y;
  }
  return attachPointFromBody(body, wx, wy, options.snap);
}

export function attachWorldFromLocal(
  body: Pick<SimBodySnapshot, "x" | "y" | "angle">,
  localX: number,
  localY: number,
): { x: number; y: number } {
  return localToWorld(body.x, body.y, body.angle, localX, localY);
}

/** Hit-test dynamic bodies at world point (topmost in layer order). */
export function pickDynamicBodyAt(
  bodies: SimBodySnapshot[],
  worldX: number,
  worldY: number,
): SimBodySnapshot | null {
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i]!;
    if (!b.visible || b.isStatic || b.entityKind === "ropeSegment") continue;
    if (b.entityKind === "wall" || b.entityKind === "floor" || b.entityKind === "collisionBounds") {
      continue;
    }
    const hw = b.width / 2;
    const hh = b.height / 2;
    const local = worldToLocal(b.x, b.y, b.angle, worldX, worldY);
    if (b.shape === "circle") {
      if (Math.hypot(local.x, local.y) <= hw) return b;
    } else if (
      Math.abs(local.x) <= hw &&
      Math.abs(local.y) <= hh
    ) {
      return b;
    }
  }
  return null;
}
