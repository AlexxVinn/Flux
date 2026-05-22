import { COLLISION_FRAME_WALL_THICKNESS } from "@/lib/physics/physicsConstants";
import type { SimBodySnapshot, SimulationSnapshot } from "@/lib/physics/types";
import type { WorldRect } from "@/lib/physics/selectionUtils";
import { isDraggableBody } from "@/lib/physics/selectionUtils";

export type TransformGizmoMode = "move" | "rotate" | "scale";

export type GizmoCorner = "nw" | "ne" | "se" | "sw";

export type TranslateAxisHit = "translate-x" | "translate-y";
export type ScaleAxisHit = "scale-x" | "scale-y";

export type TransformGizmoHit =
  | "rotate"
  | GizmoCorner
  | TranslateAxisHit
  | ScaleAxisHit;

export interface GizmoAxisArm {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface TransformGizmoLayout {
  pivot: { x: number; y: number };
  aabb: WorldRect;
  corners: Record<GizmoCorner, { x: number; y: number }>;
  rotateHandle: { x: number; y: number };
  showRotateHandle: boolean;
  /** World-space move handles along +X and +Y from pivot */
  translateX: GizmoAxisArm;
  translateY: GizmoAxisArm;
  /** Mid-edge scale grips (bounding box east / south) */
  edgeScaleEast: { x: number; y: number };
  edgeScaleSouth: { x: number; y: number };
  /** Reference spans from pivot to edges (for robust scale ratios when pointer is near pivot) */
  spanX: number;
  spanY: number;
}

export function isGizmoCorner(h: TransformGizmoHit): h is GizmoCorner {
  return h === "nw" || h === "ne" || h === "se" || h === "sw";
}

function unionRects(rects: WorldRect[]): WorldRect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
  }
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned world bounds that enclose the body's rendered shape (rim for collision frame). */
export function bodyWorldOrientedAabb(b: SimBodySnapshot): WorldRect {
  const rim = b.entityKind === "collisionBounds" ? COLLISION_FRAME_WALL_THICKNESS : 0;
  const hw = b.width / 2 + rim;
  const hh = b.height / 2 + rim;

  if (b.shape === "circle") {
    return {
      minX: b.x - hw,
      maxX: b.x + hw,
      minY: b.y - hh,
      maxY: b.y + hh,
    };
  }

  const cos = Math.cos(b.angle);
  const sin = Math.sin(b.angle);
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lx, ly] of corners) {
    const wx = b.x + lx * cos - ly * sin;
    const wy = b.y + lx * sin + ly * cos;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
  }
  return { minX, minY, maxX, maxY };
}

export function draggableBodiesFromSelection(
  snapshot: SimulationSnapshot,
  selectedIds: string[],
): SimBodySnapshot[] {
  const out: SimBodySnapshot[] = [];
  for (const id of selectedIds) {
    const b = snapshot.bodies.find((bb) => bb.id === id);
    if (b && isDraggableBody(b)) out.push(b);
  }
  return out;
}

export function selectionAllowsRotate(bodies: SimBodySnapshot[]): boolean {
  return bodies.some((b) => b.entityKind !== "collisionBounds");
}

export function worldUnitsForScreenPx(zoom: number, px: number): number {
  return px / Math.max(zoom, 1e-6);
}

/** Distance from point P to segment AB (world units). */
export function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-18) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

/** Build unified transform gizmo for the union AABB of the given draggable bodies. */
export function buildTransformGizmo(
  draggableBodies: SimBodySnapshot[],
  zoom: number,
): TransformGizmoLayout | null {
  const rects = draggableBodies.map((b) => bodyWorldOrientedAabb(b));
  const merged = unionRects(rects);
  if (!merged) return null;

  const { minX, minY, maxX, maxY } = merged;
  const pivot = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const bw = maxX - minX;
  const bh = maxY - minY;
  const arm = Math.max(worldUnitsForScreenPx(zoom, 44), bw * 0.12 + 24, bh * 0.12 + 24);

  const corners: TransformGizmoLayout["corners"] = {
    nw: { x: minX, y: minY },
    ne: { x: maxX, y: minY },
    se: { x: maxX, y: maxY },
    sw: { x: minX, y: maxY },
  };

  const showRotateHandle = selectionAllowsRotate(draggableBodies);
  const band = (bw + bh) * 0.03 + 28;
  const rotateHandle = { x: pivot.x, y: minY - band };

  const translateX: GizmoAxisArm = {
    from: pivot,
    to: { x: pivot.x + arm, y: pivot.y },
  };
  const translateY: GizmoAxisArm = {
    from: pivot,
    to: { x: pivot.x, y: pivot.y + arm },
  };
  const edgeScaleEast = { x: maxX, y: (minY + maxY) / 2 };
  const edgeScaleSouth = { x: (minX + maxX) / 2, y: maxY };

  const spanX = Math.max(Math.abs(maxX - pivot.x), Math.abs(minX - pivot.x), bw / 2, 24);
  const spanY = Math.max(Math.abs(maxY - pivot.y), Math.abs(minY - pivot.y), bh / 2, 24);

  return {
    pivot,
    aabb: merged,
    corners,
    rotateHandle,
    showRotateHandle,
    translateX,
    translateY,
    edgeScaleEast,
    edgeScaleSouth,
    spanX,
    spanY,
  };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Hit-test gizmo in world space. Respects `mode`: only active handles register.
 * Returns null if no handle under the pointer.
 */
export function hitTestTransformGizmo(
  worldX: number,
  worldY: number,
  zoom: number,
  layout: TransformGizmoLayout,
  mode: TransformGizmoMode,
): TransformGizmoHit | null {
  const hitLineMax = worldUnitsForScreenPx(zoom, 12);
  const handleR = worldUnitsForScreenPx(zoom, 11);
  const cornerOrder: GizmoCorner[] = ["nw", "ne", "se", "sw"];

  /** Prefer axis closer to cursor when arms overlap near pivot */
  const distX = distancePointToSegment(
    worldX,
    worldY,
    layout.translateX.from.x,
    layout.translateX.from.y,
    layout.translateX.to.x,
    layout.translateX.to.y,
  );
  const distY = distancePointToSegment(
    worldX,
    worldY,
    layout.translateY.from.x,
    layout.translateY.from.y,
    layout.translateY.to.x,
    layout.translateY.to.y,
  );

  if (mode === "move") {
    if (distX <= hitLineMax && distX <= distY) return "translate-x";
    if (distY <= hitLineMax) return "translate-y";
  }

  if (mode === "scale") {
    for (const c of cornerOrder) {
      const p = layout.corners[c];
      if (dist(worldX, worldY, p.x, p.y) <= handleR * 1.35) return c;
    }
    const dex = layout.edgeScaleEast;
    const dsouth = layout.edgeScaleSouth;
    if (dist(worldX, worldY, dex.x, dex.y) <= handleR * 1.2) return "scale-x";
    if (dist(worldX, worldY, dsouth.x, dsouth.y) <= handleR * 1.2) return "scale-y";
  }

  if (mode === "rotate" && layout.showRotateHandle) {
    const rh = layout.rotateHandle;
    if (dist(worldX, worldY, rh.x, rh.y) <= handleR * 1.5) return "rotate";
  }

  return null;
}

export function unwrapAngleDelta(fromRad: number, toRad: number): number {
  let d = toRad - fromRad;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
