import type { CollisionDebugPoint, SimulationSnapshot } from "./types";
import type { DebugFlags } from "./debugTypes";
import { FLUX_WORLD, type SceneCamera } from "./worldSpace";
import { COLLISION_FRAME_WALL_THICKNESS } from "./physicsConstants";

export type { DebugFlags } from "./debugTypes";

export interface RenderConfig {
  width: number;
  height: number;
  camera: SceneCamera;
  selectedIds: string[];
  hoveredId: string | null;
  debug: DebugFlags;
  gravityForBody?: (id: string) => { x: number; y: number };
  collisions?: CollisionDebugPoint[];
}

const VEL_SCALE = 12;
const FORCE_SCALE = 0.08;

export function renderSimulation(
  ctx: CanvasRenderingContext2D,
  snapshot: SimulationSnapshot,
  config: RenderConfig,
): void {
  const {
    width,
    height,
    camera,
    selectedIds,
    hoveredId,
    debug,
    gravityForBody,
    collisions = [],
  } = config;
  const selectedSet = new Set(selectedIds);

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.centerX, -camera.centerY);

  if (debug.grid) drawWorldGrid(ctx, FLUX_WORLD.WIDTH, FLUX_WORLD.HEIGHT);

  ctx.strokeStyle = "rgba(110,231,183,0.12)";
  ctx.lineWidth = 2 / camera.zoom;
  ctx.strokeRect(0, 0, FLUX_WORLD.WIDTH, FLUX_WORLD.HEIGHT);

  const sorted = [...snapshot.bodies].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  for (const body of sorted) {
    if (!body.visible) continue;

    const isSelected = selectedSet.has(body.id);
    const isHovered = body.id === hoveredId;
    const dimmed = false;

    ctx.save();
    ctx.translate(body.x, body.y);
    if (body.entityKind === "collisionBounds") {
      drawCollisionBoundsOverlay(
        ctx,
        body.width,
        body.height,
        camera.zoom,
        isSelected,
        isHovered,
      );
      ctx.globalAlpha = 1;
      ctx.restore();
      continue;
    }
    ctx.rotate(body.angle);

    if (body.isStatic) ctx.globalAlpha = 0.88;
    else if (dimmed) ctx.globalAlpha = 0.35;

    const lw = isSelected ? 2.5 : isHovered ? 2 : 1;
    ctx.lineWidth = lw / camera.zoom;

    const fill = body.isStatic ? "#1a1a1a" : isSelected ? "#3d3d3d" : "#2a2a2a";
    ctx.fillStyle = fill;
    ctx.strokeStyle = isSelected
      ? "#f5f5f5"
      : isHovered
        ? "rgba(255,255,255,0.65)"
        : "rgba(255,255,255,0.22)";

    if (body.shape === "circle") {
      const r = body.width / 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const hw = body.width / 2;
      const hh = body.height / 2;
      ctx.beginPath();
      ctx.rect(-hw, -hh, body.width, body.height);
      ctx.fill();
      ctx.stroke();
    }

    if (debug.aabbBounds) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1 / camera.zoom;
      if (body.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, body.width / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const hw = body.width / 2;
        const hh = body.height / 2;
        ctx.strokeRect(-hw, -hh, body.width, body.height);
      }
      ctx.setLineDash([]);
    }

    if (debug.centerOfMass) {
      ctx.fillStyle = "rgba(110,231,183,0.9)";
      ctx.beginPath();
      ctx.arc(0, 0, 3 / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    if (debug.sleepingBodies && body.isSleeping) {
      ctx.fillStyle = "rgba(100,149,237,0.25)";
      if (body.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, body.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const hw = body.width / 2;
        const hh = body.height / 2;
        ctx.fillRect(-hw, -hh, body.width, body.height);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();

    if (!body.isStatic) {
      if (debug.velocityVectors) {
        const speed = Math.hypot(body.velocityX, body.velocityY);
        drawWorldVector(
          ctx,
          body.x,
          body.y,
          body.velocityX * VEL_SCALE,
          body.velocityY * VEL_SCALE,
          "#34d399",
          debug.forceVectors ? `${speed.toFixed(1)} px/f` : undefined,
          camera.zoom,
        );
      }
      if (debug.gravityVectors && gravityForBody) {
        const g = gravityForBody(body.id);
        if (Math.hypot(g.x, g.y) > 0.01) {
          drawWorldVector(
            ctx,
            body.x,
            body.y,
            g.x * FORCE_SCALE,
            g.y * FORCE_SCALE,
            "#a78bfa",
            debug.forceVectors ? "g" : undefined,
            camera.zoom,
          );
        }
      }
    }
  }

  if (debug.springLinks || debug.springTension) {
    for (const spring of snapshot.springs) {
      if (!spring.visible) continue;
      const a = snapshot.bodies.find((b) => b.id === spring.bodyA);
      const b = snapshot.bodies.find((b) => b.id === spring.bodyB);
      if (!a?.visible || !b?.visible) continue;

      if (debug.springLinks) {
        ctx.strokeStyle = "rgba(170,170,170,0.7)";
        ctx.lineWidth = 1 / camera.zoom;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (debug.springTension) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const rest = dist;
        const tension = Math.abs(dist - rest) * spring.stiffness * 100;
        ctx.fillStyle = "rgba(251,191,36,0.85)";
        ctx.font = `${9 / camera.zoom}px monospace`;
        ctx.fillText(`T ${tension.toFixed(1)}`, mx + 4 / camera.zoom, my - 4 / camera.zoom);
      }
    }
  }

  if (debug.collisionContacts || debug.collisionNormals) {
    for (const c of collisions) {
      if (debug.collisionContacts) {
        ctx.fillStyle = "#f87171";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 3 / camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      if (debug.collisionNormals) {
        drawWorldVector(ctx, c.x, c.y, c.nx * 18, c.ny * 18, "#38bdf8", undefined, camera.zoom);
      }
    }
  }

  ctx.restore();

  if (debug.gravityVectors) {
    drawGlobalGravityHint(ctx, width);
  }

  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.font = "10px monospace";
  ctx.fillText(`${FLUX_WORLD.WIDTH}×${FLUX_WORLD.HEIGHT} world`, 10, height - 8);
}

function drawCollisionBoundsOverlay(
  ctx: CanvasRenderingContext2D,
  innerW: number,
  innerH: number,
  zoom: number,
  isSelected: boolean,
  isHovered: boolean,
): void {
  const hw = innerW / 2;
  const hh = innerH / 2;
  const t = COLLISION_FRAME_WALL_THICKNESS;
  const ohw = hw + t;
  const ohh = hh + t;

  ctx.fillStyle = "rgba(110,231,183,0.05)";
  ctx.beginPath();
  ctx.rect(-ohw, -ohh, ohw * 2, ohh * 2);
  ctx.rect(-hw, -hh, innerW, innerH);
  ctx.fill("evenodd");

  ctx.strokeStyle = isSelected
    ? "rgba(244,244,245,0.9)"
    : isHovered
      ? "rgba(110,231,183,0.7)"
      : "rgba(110,231,183,0.45)";
  ctx.lineWidth = (isSelected ? 2.1 : 1.35) / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  ctx.strokeRect(-hw, -hh, innerW, innerH);
  ctx.setLineDash([]);
  ctx.lineWidth = (isSelected ? 2.4 : 1.6) / zoom;
  ctx.strokeRect(-ohw, -ohh, ohw * 2, ohh * 2);
}

function drawWorldVector(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  color: string,
  label: string | undefined,
  zoom: number,
): void {
  const mag = Math.hypot(dx, dy);
  const minLen = 2 / zoom;
  if (mag < minLen) return;

  const a = Math.atan2(dy, dx);
  const ux = dx / mag;
  const uy = dy / mag;
  const headLen = Math.min(mag, 12 / zoom);
  const stemX = ox + dx - ux * headLen;
  const stemY = oy + dy - uy * headLen;
  const tipX = ox + dx;
  const tipY = oy + dy;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.85 / zoom;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(stemX, stemY);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 0.85 / zoom;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - headLen * Math.cos(a - 0.5), tipY - headLen * Math.sin(a - 0.5));
  ctx.lineTo(tipX - headLen * Math.cos(a + 0.5), tipY - headLen * Math.sin(a + 0.5));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (label) {
    const fz = Math.max(8.5, 10) / zoom;
    const padX = 4 / zoom;
    const padY = 2 / zoom;
    ctx.font = `500 ${fz}px ui-sans-serif, system-ui, sans-serif`;
    const tx = tipX + 8 / zoom;
    const ty = tipY + 3 / zoom;
    const metrics = ctx.measureText(label);
    const boxW = metrics.width + padX * 2;
    const boxH = fz + padY * 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(8,10,12,0.88)";
    ctx.beginPath();
    ctx.roundRect(tx - padX, ty - fz * 0.85, boxW, boxH, 3 / zoom);
    ctx.fill();
    ctx.fillStyle = "rgba(248,250,252,0.94)";
    ctx.fillText(label, tx, ty);
  }

  ctx.restore();
}

function drawGlobalGravityHint(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "10px monospace";
  ctx.fillText("↓ gravity +Y", width - 88, 16);
}

function drawWorldGrid(ctx: CanvasRenderingContext2D, worldW: number, worldH: number): void {
  const minor = 100;
  const major = 500;
  for (let x = 0; x <= worldW; x += minor) {
    const isMajor = x % major === 0;
    ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)";
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, worldH);
    ctx.stroke();
  }
  for (let y = 0; y <= worldH; y += minor) {
    const isMajor = y % major === 0;
    ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)";
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(worldW, y);
    ctx.stroke();
  }
}
