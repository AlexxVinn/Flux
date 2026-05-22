import { pxToM } from "./units";
import type { SceneMarkupKind, SceneMarkupSnapshot, SimulationSnapshot } from "./types";
import { pointToSegmentDistSq } from "./selectionUtils";

const MARKUP_PICK_PX = 14;
const ARROW_COLOR = "rgba(251, 191, 36, 0.92)";
const ARROW_SELECTED = "rgba(255, 255, 255, 0.95)";
const MEASURE_COLOR = "rgba(110, 231, 183, 0.88)";
const TEXT_COLOR = "rgba(251, 191, 36, 0.95)";

export function markupsFromSnapshot(snapshot: SimulationSnapshot): SceneMarkupSnapshot[] {
  return snapshot.markups ?? [];
}

export function attachMarkupsToSnapshot(
  engineSnap: Omit<SimulationSnapshot, "markups"> & Partial<Pick<SimulationSnapshot, "markups">>,
  markups: SceneMarkupSnapshot[] | undefined,
): SimulationSnapshot {
  return { ...engineSnap, markups: markups ?? engineSnap.markups ?? [] };
}

function countAuthoringBodies(snap: SimulationSnapshot): number {
  return snap.bodies.filter(
    (b) =>
      b.entityKind !== "wall" &&
      b.entityKind !== "floor" &&
      b.entityKind !== "ropeSegment",
  ).length;
}

/**
 * Merge Matter physics with document markups. Never let an empty engine snapshot
 * wipe a populated store (e.g. markup placed before hydrate/reconcile finishes).
 */
export function mergeEngineSnapshotWithDocument(
  prev: SimulationSnapshot,
  engineSnap: SimulationSnapshot,
): SimulationSnapshot {
  const prevAuthoring = countAuthoringBodies(prev);
  const engineAuthoring = countAuthoringBodies(engineSnap);
  const usePrevPhysics =
    engineAuthoring === 0 &&
    (prevAuthoring > 0 || prev.springs.length > 0 || (prev.ropes?.length ?? 0) > 0);

  const physics = usePrevPhysics
    ? {
        bodies: prev.bodies,
        springs: prev.springs,
        ropes: prev.ropes ?? [],
        tick: engineSnap.tick,
      }
    : {
        bodies: engineSnap.bodies,
        springs: engineSnap.springs,
        ropes: engineSnap.ropes ?? [],
        tick: engineSnap.tick,
      };

  const markups = prev.markups ?? engineSnap.markups ?? [];
  return attachMarkupsToSnapshot(physics, markups);
}

export function markupDistanceWorldPx(m: SceneMarkupSnapshot): number {
  if (m.points.length < 2) return 0;
  const [a, b] = m.points;
  return Math.hypot(b!.x - a!.x, b!.y - a!.y);
}

export function markupDistanceM(m: SceneMarkupSnapshot): number {
  return pxToM(markupDistanceWorldPx(m));
}

export function drawSceneMarkups(
  ctx: CanvasRenderingContext2D,
  markups: SceneMarkupSnapshot[],
  zoom: number,
  selectedIds: Set<string>,
): void {
  for (const m of markups) {
    if (!m.visible) continue;
    const selected = selectedIds.has(m.id);
    drawOneMarkup(ctx, m, zoom, selected);
  }
}

function drawOneMarkup(
  ctx: CanvasRenderingContext2D,
  m: SceneMarkupSnapshot,
  zoom: number,
  selected: boolean,
): void {
  const stroke = selected
    ? ARROW_SELECTED
    : m.kind === "measure"
      ? MEASURE_COLOR
      : ARROW_COLOR;
  const lw = (selected ? 2.2 : 1.6) / zoom;

  if (m.kind === "text" && m.points.length >= 1) {
    const p = m.points[0]!;
    ctx.save();
    ctx.font = `${Math.max(11, 12 / zoom)}px system-ui, sans-serif`;
    ctx.fillStyle = stroke;
    if (selected) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1 / zoom;
      const pad = 4 / zoom;
      const w = ctx.measureText(m.text ?? "Note").width;
      ctx.strokeRect(p.x - pad, p.y - pad, w + pad * 2, 12 / zoom + pad * 2);
    }
    ctx.fillText(m.text ?? "Note", p.x, p.y);
    ctx.restore();
    return;
  }

  if (m.points.length < 2) return;
  const [a, b] = m.points;
  const ax = a!.x;
  const ay = a!.y;
  const bx = b!.x;
  const by = b!.y;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";

  if (m.kind === "measure") {
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);

    const unit = m.measureUnit ?? "m";
    const distM = markupDistanceM(m);
    const label =
      unit === "cm" ? `${(distM * 100).toFixed(1)} cm` : `${distM.toFixed(2)} m`;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    ctx.font = `${Math.max(9, 10 / zoom)}px ui-monospace, monospace`;
    ctx.fillStyle = stroke;
    ctx.textAlign = "center";
    ctx.fillText(label, mx, my - 8 / zoom);
  } else {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    drawArrowHead(ctx, ax, ay, bx, by, zoom, stroke);
  }

  for (const p of [a!, b!]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, (selected ? 4 : 3) / zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  zoom: number,
  color: string,
): void {
  const ang = Math.atan2(by - ay, bx - ax);
  const head = 10 / zoom;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(
    bx - head * Math.cos(ang - 0.42),
    by - head * Math.sin(ang - 0.42),
  );
  ctx.lineTo(
    bx - head * Math.cos(ang + 0.42),
    by - head * Math.sin(ang + 0.42),
  );
  ctx.closePath();
  ctx.fill();
}

export function pickMarkupAt(
  snapshot: SimulationSnapshot,
  worldX: number,
  worldY: number,
  zoom: number,
): string | null {
  const tolSq = (MARKUP_PICK_PX / zoom) ** 2;
  const markups = markupsFromSnapshot(snapshot);
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i]!;
    if (!m.visible) continue;
    if (m.kind === "text" && m.points.length >= 1) {
      const p = m.points[0]!;
      const dx = worldX - p.x;
      const dy = worldY - p.y;
      if (dx * dx + dy * dy <= tolSq * 4) return m.id;
      continue;
    }
    if (m.points.length < 2) continue;
    const [a, b] = m.points;
    if (
      pointToSegmentDistSq(worldX, worldY, a!.x, a!.y, b!.x, b!.y) <= tolSq
    ) {
      return m.id;
    }
  }
  return null;
}

export function markupBounds(m: SceneMarkupSnapshot): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (m.points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of m.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 8;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function markupIntersectsRect(
  m: SceneMarkupSnapshot,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const b = markupBounds(m);
  if (!b) return false;
  return (
    b.minX <= rect.maxX &&
    b.maxX >= rect.minX &&
    b.minY <= rect.maxY &&
    b.maxY >= rect.minY
  );
}

/** Draft preview while placing a new markup. */
export function drawMarkupDraft(
  ctx: CanvasRenderingContext2D,
  kind: SceneMarkupKind,
  points: { x: number; y: number }[],
  previewEnd: { x: number; y: number } | null,
  zoom: number,
): void {
  const pts =
    points.length === 1 && previewEnd ? [points[0]!, previewEnd] : points;
  if (pts.length === 0) return;
  const draft: SceneMarkupSnapshot = {
    id: "__draft__",
    displayName: "",
    kind,
    points: pts,
    visible: true,
    measureUnit: "m",
  };
  if (kind === "text" && pts.length >= 1) {
    draft.text = "Note";
  }
  drawOneMarkup(ctx, draft, zoom, false);
}
