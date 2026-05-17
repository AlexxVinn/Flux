import { ropePolylineFromSnapshot } from "@/lib/physics/ropeGeometry";
import { strokeSmoothRope } from "@/lib/physics/ropeRender";
import type { SimulationSnapshot } from "@/lib/physics/types";
import { identiconGrid } from "./avatar";
import {
  getEntityBounds,
  type PeerEntityMark,
} from "./peerSelection";

const BADGE_R = 9;
const BADGE_GAP = 3;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(110,231,183,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawIdenticonBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  userId: string,
  color: string,
  zoom: number,
): void {
  const r = BADGE_R / zoom;
  const cell = (r * 1.1) / 5;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.1 / zoom;
  ctx.stroke();

  const grid = identiconGrid(userId);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const ox = cx - (cell * 5) / 2 + cell * 0.5;
  const oy = cy - (cell * 5) / 2 + cell * 0.5;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      if (!grid[y]![x]) continue;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell * 0.88, cell * 0.88);
    }
  }
  ctx.restore();
}

function drawPeerHighlightRect(
  ctx: CanvasRenderingContext2D,
  bounds: ReturnType<typeof getEntityBounds>,
  color: string,
  zoom: number,
): void {
  if (!bounds) return;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  ctx.save();
  ctx.fillStyle = hexToRgba(color, 0.08);
  ctx.fillRect(bounds.minX, bounds.minY, w, h);
  ctx.strokeStyle = hexToRgba(color, 0.72);
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.strokeRect(bounds.minX, bounds.minY, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawPeerHighlightSpring(
  ctx: CanvasRenderingContext2D,
  snapshot: SimulationSnapshot,
  entityId: string,
  color: string,
  zoom: number,
): void {
  const spring = snapshot.springs.find((s) => s.id === entityId);
  if (!spring) return;
  const a = snapshot.bodies.find((b) => b.id === spring.bodyA);
  const b = snapshot.bodies.find((b) => b.id === spring.bodyB);
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.8);
  ctx.lineWidth = 2.4 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawPeerHighlightRope(
  ctx: CanvasRenderingContext2D,
  snapshot: SimulationSnapshot,
  entityId: string,
  color: string,
  zoom: number,
): void {
  const rope = (snapshot.ropes ?? []).find((r) => r.id === entityId);
  if (!rope) return;
  const pts = ropePolylineFromSnapshot(rope);
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.82);
  ctx.lineWidth = 2.6 / zoom;
  ctx.lineCap = "round";
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  strokeSmoothRope(ctx, pts);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawPeerSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  snapshot: SimulationSnapshot,
  peerMarksByEntity: Map<string, PeerEntityMark[]>,
  zoom: number,
): void {
  for (const [entityId, marks] of peerMarksByEntity) {
    if (marks.length === 0) continue;
    const primary = marks[0]!;
    const bounds = getEntityBounds(snapshot, entityId);
    if (!bounds) continue;

    const spring = snapshot.springs.some((s) => s.id === entityId);
    const rope = (snapshot.ropes ?? []).some((r) => r.id === entityId);
    if (spring) {
      drawPeerHighlightSpring(ctx, snapshot, entityId, primary.color, zoom);
    } else if (rope) {
      drawPeerHighlightRope(ctx, snapshot, entityId, primary.color, zoom);
    } else {
      drawPeerHighlightRect(ctx, bounds, primary.color, zoom);
    }

    const badgeStep = (BADGE_R * 2 + BADGE_GAP) / zoom;
    marks.forEach((mark, i) => {
      const bx = bounds.anchorX + i * badgeStep + BADGE_R / zoom;
      const by = bounds.anchorY - BADGE_R / zoom;
      drawIdenticonBadge(ctx, bx, by, mark.userId, mark.color, zoom);
    });
  }
}
