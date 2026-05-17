import { attachWorldFromLocal, worldToLocal } from "./bodyAttachPoint";
import { ropePolylineFromSnapshot } from "./ropeGeometry";
import type { SimBodySnapshot, SimulationSnapshot } from "./types";
import { COLLISION_FRAME_WALL_THICKNESS } from "./physicsConstants";

const PICK_SPRING_ROPE_PX = 18;

export function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

function pickBodyAt(
  snapshot: SimulationSnapshot,
  worldX: number,
  worldY: number,
): string | null {
  const bodies = snapshot.bodies.filter((b) => b.visible);
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i]!;
    if (b.entityKind === "ropeSegment") continue;
    const rim = b.entityKind === "collisionBounds" ? COLLISION_FRAME_WALL_THICKNESS : 0;
    const hw = b.width / 2 + rim;
    const hh = b.height / 2 + rim;
    const local = worldToLocal(b.x, b.y, b.angle, worldX, worldY);
    if (b.shape === "circle") {
      if (Math.hypot(local.x, local.y) <= hw) return b.id;
    } else if (Math.abs(local.x) <= hw && Math.abs(local.y) <= hh) {
      return b.id;
    }
  }
  return null;
}

function pickConstraintLinesAt(
  snapshot: SimulationSnapshot,
  worldX: number,
  worldY: number,
  tolSq: number,
): string | null {
  for (const spring of [...snapshot.springs].reverse()) {
    if (!spring.visible) continue;
    const a = snapshot.bodies.find((b) => b.id === spring.bodyA);
    const b = snapshot.bodies.find((b) => b.id === spring.bodyB);
    if (!a?.visible || !b?.visible) continue;
    const aw = attachWorldFromLocal(a, spring.anchorA?.x ?? 0, spring.anchorA?.y ?? 0);
    const bw = attachWorldFromLocal(b, spring.anchorB?.x ?? 0, spring.anchorB?.y ?? 0);
    if (pointToSegmentDistSq(worldX, worldY, aw.x, aw.y, bw.x, bw.y) <= tolSq) {
      return spring.id;
    }
  }

  for (const rope of [...(snapshot.ropes ?? [])].reverse()) {
    if (!rope.visible) continue;
    const a = snapshot.bodies.find((b) => b.id === rope.bodyA);
    const b = snapshot.bodies.find((b) => b.id === rope.bodyB);
    if (!a?.visible || !b?.visible) continue;
    const poly = ropePolylineFromSnapshot(rope);
    if (poly.length < 2) continue;
    for (let i = 0; i < poly.length - 1; i++) {
      const p0 = poly[i]!;
      const p1 = poly[i + 1]!;
      if (pointToSegmentDistSq(worldX, worldY, p0.x, p0.y, p1.x, p1.y) <= tolSq) {
        return rope.id;
      }
    }
  }

  return null;
}

/**
 * Topmost entity under the cursor — bodies first, then springs/ropes on thin lines.
 */
export function pickEntityAt(
  snapshot: SimulationSnapshot,
  worldX: number,
  worldY: number,
  zoom: number,
): string | null {
  const tolSq = (PICK_SPRING_ROPE_PX / zoom) ** 2;

  const bodyHit = pickBodyAt(snapshot, worldX, worldY);
  if (bodyHit) return bodyHit;

  return pickConstraintLinesAt(snapshot, worldX, worldY, tolSq);
}

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function isDraggableBody(b: SimBodySnapshot): boolean {
  if (!b.visible) return false;
  if (b.entityKind === "wall" || b.entityKind === "floor" || b.entityKind === "ropeSegment") {
    return false;
  }
  return !b.isStatic || b.entityKind === "collisionBounds";
}

export function worldRectFromPoints(ax: number, ay: number, bx: number, by: number): WorldRect {
  return {
    minX: Math.min(ax, bx),
    minY: Math.min(ay, by),
    maxX: Math.max(ax, bx),
    maxY: Math.max(ay, by),
  };
}

export function rectIntersectsRect(a: WorldRect, b: WorldRect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function rectIntersectsSegment(
  rect: WorldRect,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (rectContainsPoint(rect, ax, ay) || rectContainsPoint(rect, bx, by)) return true;
  const edges: [number, number, number, number][] = [
    [rect.minX, rect.minY, rect.maxX, rect.minY],
    [rect.maxX, rect.minY, rect.maxX, rect.maxY],
    [rect.maxX, rect.maxY, rect.minX, rect.maxY],
    [rect.minX, rect.maxY, rect.minX, rect.minY],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    if (segmentsIntersect(ax, ay, bx, by, x1, y1, x2, y2)) return true;
  }
  return false;
}

function rectContainsPoint(rect: WorldRect, x: number, y: number): boolean {
  return x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Layer-order ids matching buildLayerList (walls/frames/rest, springs, ropes). */
export function collectSelectableIds(snapshot: SimulationSnapshot): string[] {
  const ids: string[] = [];
  const walls = snapshot.bodies.filter((b) => b.entityKind === "wall");
  const frames = snapshot.bodies.filter((b) => b.entityKind === "collisionBounds");
  const rest = snapshot.bodies.filter(
    (b) =>
      b.entityKind !== "wall" &&
      b.entityKind !== "collisionBounds" &&
      b.entityKind !== "ropeSegment",
  );
  for (const b of [...walls, ...frames, ...rest]) {
    if (b.visible) ids.push(b.id);
  }
  for (const s of snapshot.springs) {
    if (s.visible) ids.push(s.id);
  }
  for (const r of snapshot.ropes ?? []) {
    if (r.visible) ids.push(r.id);
  }
  return ids;
}

/** Entity ids whose bounds intersect the marquee (world AABB). */
export function idsInMarqueeRect(snapshot: SimulationSnapshot, rect: WorldRect): string[] {
  if (rect.maxX - rect.minX < 1e-6 && rect.maxY - rect.minY < 1e-6) return [];

  const found = new Set<string>();

  for (const b of snapshot.bodies) {
    if (!b.visible || b.entityKind === "ropeSegment") continue;
    const rim = b.entityKind === "collisionBounds" ? COLLISION_FRAME_WALL_THICKNESS : 0;
    const hw = b.width / 2 + rim;
    const hh = b.height / 2 + rim;
    const bodyRect: WorldRect = {
      minX: b.x - hw,
      minY: b.y - hh,
      maxX: b.x + hw,
      maxY: b.y + hh,
    };
    if (!rectIntersectsRect(rect, bodyRect)) continue;
    found.add(b.id);
  }

  for (const sp of snapshot.springs) {
    if (!sp.visible) continue;
    const a = snapshot.bodies.find((b) => b.id === sp.bodyA);
    const b = snapshot.bodies.find((b) => b.id === sp.bodyB);
    if (!a?.visible || !b?.visible) continue;
    const aw = attachWorldFromLocal(a, sp.anchorA?.x ?? 0, sp.anchorA?.y ?? 0);
    const bw = attachWorldFromLocal(b, sp.anchorB?.x ?? 0, sp.anchorB?.y ?? 0);
    if (rectIntersectsSegment(rect, aw.x, aw.y, bw.x, bw.y)) found.add(sp.id);
  }

  for (const rope of snapshot.ropes ?? []) {
    if (!rope.visible) continue;
    const a = snapshot.bodies.find((b) => b.id === rope.bodyA);
    const b = snapshot.bodies.find((b) => b.id === rope.bodyB);
    if (!a?.visible || !b?.visible) continue;
    const poly = ropePolylineFromSnapshot(rope);
    if (poly.length < 2) continue;
    let hit = false;
    for (let i = 0; i < poly.length - 1; i++) {
      const p0 = poly[i]!;
      const p1 = poly[i + 1]!;
      if (rectIntersectsSegment(rect, p0.x, p0.y, p1.x, p1.y)) {
        hit = true;
        break;
      }
    }
    if (hit) found.add(rope.id);
  }

  return collectSelectableIds(snapshot).filter((id) => found.has(id));
}
