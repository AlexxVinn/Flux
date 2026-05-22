import type { PeerEntityMark } from "@/lib/collaboration/peerSelection";
import { drawPeerSelectionOverlay } from "@/lib/collaboration/peerCanvasOverlay";
import { strokeSmoothRope } from "./ropeRender";
import { attachWorldFromLocal } from "./bodyAttachPoint";
import { ropePolylineFromSnapshot } from "./ropeGeometry";
import { drawMarkupDraft, drawSceneMarkups } from "./sceneMarkups";
import type { CollisionDebugPoint, SceneMarkupKind, SimulationSnapshot } from "./types";
import type { WorldRect } from "./selectionUtils";
import type { DebugFlags } from "./debugTypes";
import type { TransformGizmoLayout, TransformGizmoMode } from "./transformGizmo";
import { FLUX_WORLD, type SceneCamera } from "./worldSpace";
import { pxToM, formatLengthM, approximateNewtonSiFromMatterAppliedForceComponent, pxPerSecToMPerSec, formatForceNMagnitudeAdaptive } from "./units";
import { COLLISION_FRAME_WALL_THICKNESS } from "./physicsConstants";
import { effectiveElasticForceNnOnSelfTowardOther } from "./springElastic";
import { inferElasticKnFromMatterConstraintStiffness, isRigidBarSpring } from "./springDefaults";
import { estimateContactFrictionNn } from "./contactFrictionEstimate";

export type { DebugFlags } from "./debugTypes";

export interface RenderConfig {
  width: number;
  height: number;
  camera: SceneCamera;
  selectedIds: string[];
  hoveredId: string | null;
  debug: DebugFlags;
  gravityForBody?: (id: string) => { x: number; y: number };
  /** Active sustained user forces in newtons (body id → Fx, Fy). */
  appliedForcesNewtons?: Map<string, { x: number; y: number }>;
  /** Ghost arrow while editing Fx/Fy in the force tool (body id + components in N). */
  forcePreview?: { bodyId: string; fxN: number; fyN: number } | null;
  /** Brief impulse flash after Apply (body id + components in N). */
  forceFlash?: { bodyId: string; fxN: number; fyN: number; alpha: number } | null;
  collisions?: CollisionDebugPoint[];
  /** Active marquee in world space (drawn while dragging select tool). */
  selectionMarquee?: WorldRect | null;
  /** Other users' selections (entity id → peers). */
  peerMarksByEntity?: Map<string, PeerEntityMark[]>;
  /** Rubber-band while placing a spring or rope (world space). */
  linkPlacementPreview?: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    kind: "spring" | "rigidBar" | "rope";
  } | null;
  /** Selection transform gizmo (setup / authoring). */
  transformGizmo?: TransformGizmoLayout | null;
  /** Which transform mode is active (affects handle emphasis). */
  transformGizmoMode?: TransformGizmoMode;
  /** Playback paths (world px) up to the current timeline review frame. */
  bodyTrajectories?: { bodyId: string; points: { x: number; y: number }[] }[];
  measureStart?: { x: number; y: number } | null;
  measureEnd?: { x: number; y: number } | null;
  measureUnit?: "m" | "cm";
  /** Placement preview for arrow / text / ruler tools. */
  markupDraft?: {
    kind: SceneMarkupKind;
    points: { x: number; y: number }[];
    previewEnd: { x: number; y: number } | null;
  } | null;
}

function springEndpoints(
  spring: SimulationSnapshot["springs"][number],
  snapshot: SimulationSnapshot,
): { ax: number; ay: number; bx: number; by: number } | null {
  const a = snapshot.bodies.find((b) => b.id === spring.bodyA);
  const b = snapshot.bodies.find((b) => b.id === spring.bodyB);
  if (!a?.visible || !b?.visible) return null;
  const aw = attachWorldFromLocal(a, spring.anchorA?.x ?? 0, spring.anchorA?.y ?? 0);
  const bw = attachWorldFromLocal(b, spring.anchorB?.x ?? 0, spring.anchorB?.y ?? 0);
  return { ax: aw.x, ay: aw.y, bx: bw.x, by: bw.y };
}

/** Gravity at CoM in newtons — same pathway as arrows in {@link renderSimulation}. */
function weightNnAtCoM(
  snapshot: SimulationSnapshot,
  bodyId: string,
  gravityForBody: (id: string) => { x: number; y: number },
): { fx: number; fy: number } {
  const b = snapshot.bodies.find((body) => body.id === bodyId);
  if (!b?.visible || b.isStatic) return { fx: 0, fy: 0 };
  const g = gravityForBody(bodyId);
  return {
    fx: approximateNewtonSiFromMatterAppliedForceComponent(g.x, b.mass),
    fy: approximateNewtonSiFromMatterAppliedForceComponent(g.y, b.mass),
  };
}

const VEL_SCALE = 14;

/** When hovering / selecting / force-preview, diagram arrows share scale from largest visible vector. */
const DIAGRAM_REL_SCALE_MIN_ARROW_RATIO = 0.09;

const FORCE_KIND_STYLE = {
  weight: {
    stroke: "#c4b5fd",
    fill: "#a78bfa",
    glow: "rgba(167,139,250,0.22)",
    tag: "G",
  },
  applied: {
    stroke: "#fdba74",
    fill: "#fb923c",
    glow: "rgba(251,146,60,0.2)",
    tag: "F",
  },
  preview: {
    stroke: "#fde68a",
    fill: "#fbbf24",
    glow: "rgba(251,191,36,0.18)",
    tag: "F",
  },
  elastic: {
    stroke: "#5eead4",
    fill: "#2dd4bf",
    glow: "rgba(45,212,191,0.2)",
    tag: "Fs",
  },
  normal: {
    stroke: "#7dd3fc",
    fill: "#38bdf8",
    glow: "rgba(56,189,248,0.2)",
    tag: "Fn",
  },
  friction: {
    stroke: "#fb923c",
    fill: "#ea580c",
    glow: "rgba(234,88,12,0.2)",
    tag: "Ff",
  },
} as const;

type ForceKind = keyof typeof FORCE_KIND_STYLE;

/** On-screen px — stable when zoom changes (avoid 180/zoom exploding when zoom&lt;1). */
const FORCE_ARROW_MIN_SCREEN_PX = 22;
const FORCE_ARROW_MAX_SCREEN_PX = 52;

/**
 * Compress large forces onto a 0–1 curve so visuals stay pedagogical:
 * arrows show direction + “more vs less”; exact N stays in the hover/selection label only.
 */
function forceMagnitudeVisualT(magN: number): number {
  if (!Number.isFinite(magN) || magN <= 0) return 0;
  return Math.min(1, Math.log1p(magN) / Math.log1p(280));
}

/** World-space arrow length (~constant footprint on screen at any zoom). */
function forceMagNToArrowLen(magN: number, zoom: number): number {
  if (!(zoom > 0)) return 0;
  const t = forceMagnitudeVisualT(magN);
  const minWorld = FORCE_ARROW_MIN_SCREEN_PX / zoom;
  const maxWorld = FORCE_ARROW_MAX_SCREEN_PX / zoom;
  return minWorld + t * (maxWorld - minWorld);
}

/** Length in world px for pedagogical overlays when multiple vectors compete (hover/selection diagrams). */
function diagramRelativeArrowWorldLen(
  scalarMag: number,
  diagDenom: number,
  multipleDiagramVectors: boolean,
  zoom: number,
): number {
  if (!(zoom > 0)) return 0;
  const LmaxWorld = FORCE_ARROW_MAX_SCREEN_PX / zoom;
  const d = Math.max(diagDenom, 1e-30);
  let len = (scalarMag / d) * LmaxWorld;
  if (multipleDiagramVectors && len > 1e-20) {
    len = Math.max(len, DIAGRAM_REL_SCALE_MIN_ARROW_RATIO * LmaxWorld);
  }
  return Math.min(len, LmaxWorld);
}

function elasticKFromSpringSnapshot(spring: SimulationSnapshot["springs"][number]): number {
  return typeof spring.elasticConstantNnPerM === "number" &&
    Number.isFinite(spring.elasticConstantNnPerM)
    ? spring.elasticConstantNnPerM
    : inferElasticKnFromMatterConstraintStiffness(spring.stiffness);
}

function drawSpringElasticForceOverlays(
  ctx: CanvasRenderingContext2D,
  snapshot: SimulationSnapshot,
  zoom: number,
  hoveredId: string | null,
  debug: DebugFlags,
  selectedSet: Set<string>,
  gravityForBody: undefined | ((id: string) => { x: number; y: number }),
  labelQueue?: QueuedVectorLabel[],
): void {
  const ambient = !!(debug.forceVectors && debug.springElasticAmbient);
  const gravity =
    gravityForBody ?? ((): { x: number; y: number } => ({
      x: 0,
      y: 0,
    }));

  for (const spring of snapshot.springs) {
    if (!spring.visible) continue;
    const ends = springEndpoints(spring, snapshot);
    if (!ends) continue;

    const onSpringHover = hoveredId === spring.id;
    const hoverA = hoveredId === spring.bodyA;
    const hoverB = hoveredId === spring.bodyB;
    const sa = selectedSet.has(spring.bodyA);
    const sb = selectedSet.has(spring.bodyB);
    const bothEndsSelected = sa && sb;
    const dual =
      ambient ||
      onSpringHover ||
      selectedSet.has(spring.id) ||
      bothEndsSelected;

    if (
      !(
        ambient ||
        onSpringHover ||
        hoverA ||
        hoverB ||
        sa ||
        sb ||
        selectedSet.has(spring.id)
      )
    ) {
      continue;
    }

    let focal: "a" | "b" | null = null;
    if (!dual) {
      if (hoverA && !hoverB) focal = "a";
      else if (hoverB && !hoverA) focal = "b";
      else if (sa && !sb) focal = "a";
      else if (sb && !sa) focal = "b";
      else focal = null;
    }

    const showArrowA = dual || focal === "a";
    const showArrowB = dual || focal === "b";

    const kNn = elasticKFromSpringSnapshot(spring);
    const wieA = weightNnAtCoM(snapshot, spring.bodyA, gravity);
    const fa = effectiveElasticForceNnOnSelfTowardOther({
      kNnPerMeter: kNn,
      selfX: ends.ax,
      selfY: ends.ay,
      otherX: ends.bx,
      otherY: ends.by,
      restLenPx: spring.length,
      weightNn: wieA,
    });
    const wieB = weightNnAtCoM(snapshot, spring.bodyB, gravity);
    const fb = effectiveElasticForceNnOnSelfTowardOther({
      kNnPerMeter: kNn,
      selfX: ends.bx,
      selfY: ends.by,
      otherX: ends.ax,
      otherY: ends.ay,
      restLenPx: spring.length,
      weightNn: wieB,
    });

    const suppressElasticLabels =
      ambient &&
      !(
        onSpringHover ||
        hoverA ||
        hoverB ||
        sa ||
        sb ||
        selectedSet.has(spring.id)
      );

    const emphasize =
      onSpringHover ||
      selectedSet.has(spring.id) ||
      hoverA ||
      hoverB ||
      sa ||
      sb;

    const labelA =
      !suppressElasticLabels && showArrowA && (dual ? emphasize : focal === "a");
    const labelB =
      !suppressElasticLabels && showArrowB && (dual ? emphasize : focal === "b");

    if (showArrowA && Math.hypot(fa.fx, fa.fy) > 1e-12) {
      drawForceArrow(
        ctx,
        ends.ax,
        ends.ay,
        fa.fx,
        fa.fy,
        "elastic",
        zoom,
        {
          label: debug.forceLabels && labelA ? formatForceNMagnitudeAdaptive(fa.magNn) : undefined,
        },
        labelQueue,
      );
    }
    if (showArrowB && Math.hypot(fb.fx, fb.fy) > 1e-12) {
      drawForceArrow(
        ctx,
        ends.bx,
        ends.by,
        fb.fx,
        fb.fy,
        "elastic",
        zoom,
        {
          label: debug.forceLabels && labelB ? formatForceNMagnitudeAdaptive(fb.magNn) : undefined,
        },
        labelQueue,
      );
    }
  }
}

function drawBodyTrajectories(
  ctx: CanvasRenderingContext2D,
  trajectories: { bodyId: string; points: { x: number; y: number }[] }[],
  zoom: number,
): void {
  if (trajectories.length === 0) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.58)";
  ctx.lineWidth = 1 / zoom;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([5 / zoom, 4 / zoom]);

  for (const { points } of trajectories) {
    if (points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i]!.x, points[i]!.y);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function drawTapeMeasure(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  unit: "m" | "cm",
  zoom: number,
): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distPx = Math.hypot(dx, dy);
  if (distPx < 1) return;

  const distM = pxToM(distPx);
  const displayVal = unit === "cm" ? distM * 100 : distM;
  const displayLabel = unit === "cm" ? `${displayVal.toFixed(1)} cm` : `${displayVal.toFixed(2)} m`;

  ctx.save();

  // Draw main line in vivid emerald green
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 1.8 / zoom;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // Draw end ticks or caps perpendicular to the line
  const angle = Math.atan2(dy, dx);
  const cosPerp = Math.cos(angle + Math.PI / 2);
  const sinPerp = Math.sin(angle + Math.PI / 2);
  const tickHalfLen = 8 / zoom;

  for (const p of [start, end]) {
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2.2 / zoom;
    ctx.beginPath();
    ctx.moveTo(p.x - cosPerp * tickHalfLen, p.y - sinPerp * tickHalfLen);
    ctx.lineTo(p.x + cosPerp * tickHalfLen, p.y + sinPerp * tickHalfLen);
    ctx.stroke();

    // Small inner dot
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw intermediate ticks along the line
  const stepPx = 10; // 10cm
  const tickCount = Math.floor(distPx / stepPx);
  ctx.strokeStyle = "rgba(16, 185, 129, 0.45)";
  ctx.lineWidth = 0.8 / zoom;
  for (let i = 1; i < tickCount; i++) {
    const d = i * stepPx;
    const px = start.x + (dx * d) / distPx;
    const py = start.y + (dy * d) / distPx;
    const isMajor = i % 10 === 0;
    const tLen = (isMajor ? 5 : 3) / zoom;
    ctx.beginPath();
    ctx.moveTo(px - cosPerp * tLen, py - sinPerp * tLen);
    ctx.lineTo(px + cosPerp * tLen, py + sinPerp * tLen);
    ctx.stroke();
  }

  // Draw background badge for the measurement label
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;

  ctx.font = `bold ${Math.min(13, Math.max(10, 11 / zoom))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const textWidth = ctx.measureText(displayLabel).width;
  const paddingX = 8 / zoom;
  const paddingY = 4 / zoom;
  const badgeW = textWidth + paddingX * 2;
  const badgeH = Math.min(13, Math.max(10, 11 / zoom)) + paddingY * 2;

  ctx.fillStyle = "#064e3b"; // dark emerald
  ctx.strokeStyle = "#34d399"; // light emerald border
  ctx.lineWidth = 1 / zoom;

  ctx.save();
  ctx.translate(mx, my);
  ctx.beginPath();
  const rx = -badgeW / 2;
  const ry = -badgeH / 2;
  if (ctx.roundRect) {
    ctx.roundRect(rx, ry, badgeW, badgeH, 4 / zoom);
  } else {
    ctx.rect(rx, ry, badgeW, badgeH);
  }
  ctx.fill();
  ctx.stroke();

  // Render text inside badge
  ctx.fillStyle = "#6ee7b7"; // mint
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayLabel, 0, 0);
  ctx.restore();

  ctx.restore();
}

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
    appliedForcesNewtons,
    forcePreview = null,
    forceFlash = null,
    collisions = [],
    selectionMarquee = null,
    peerMarksByEntity,
    linkPlacementPreview = null,
    transformGizmo = null,
    transformGizmoMode = "move",
    bodyTrajectories = [],
    measureStart = null,
    measureEnd = null,
    measureUnit = "m",
    markupDraft = null,
  } = config;
  const selectedSet = new Set(selectedIds);

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.centerX, -camera.centerY);

  if (debug.grid) drawWorldGrid(ctx, FLUX_WORLD.WIDTH, FLUX_WORLD.HEIGHT, camera.zoom);

  ctx.strokeStyle = "rgba(110,231,183,0.12)";
  ctx.lineWidth = 2 / camera.zoom;
  ctx.strokeRect(0, 0, FLUX_WORLD.WIDTH, FLUX_WORLD.HEIGHT);

  drawBodyTrajectories(ctx, bodyTrajectories, camera.zoom);

  const sorted = [...snapshot.bodies].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  const vectorLabelQueue: QueuedVectorLabel[] = [];

  for (const body of sorted) {
    if (!body.visible || body.entityKind === "ropeSegment") continue;

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

    const hoveredHere = body.id === hoveredId;
    const overlayForces = !!(debug.forceVectors || hoveredHere);

    const emphasizeForces =
      forcePreview?.bodyId === body.id ||
      forceFlash?.bodyId === body.id ||
      hoveredHere ||
      selectedSet.has(body.id);

    /** Hover / selection / force-tool edits: shrink all arrows with one scale so the force sum is readable even at low N or small sliders. */
    const diagramRelBasis = !body.isStatic && emphasizeForces;

    const showWeight =
      !body.isStatic &&
      !!gravityForBody &&
      ((debug.forceVectors && debug.gravityVectors) || hoveredHere);
    const showApplied =
      !body.isStatic &&
      !!appliedForcesNewtons &&
      ((debug.forceVectors && debug.appliedForces) || hoveredHere);

    let diagDenom = 0;
    let diagCount = 0;
    const noteDiagramScalar = (s: number) => {
      if (s > 1e-18) {
        diagDenom = Math.max(diagDenom, s);
        diagCount += 1;
      }
    };

    if (diagramRelBasis) {
      if (overlayForces) {
        if (showWeight && gravityForBody) {
          const g = gravityForBody(body.id);
          const gxN = approximateNewtonSiFromMatterAppliedForceComponent(g.x, body.mass);
          const gyN = approximateNewtonSiFromMatterAppliedForceComponent(g.y, body.mass);
          noteDiagramScalar(Math.hypot(gxN, gyN));
        }
        if (showApplied && appliedForcesNewtons) {
          const f = appliedForcesNewtons.get(body.id);
          if (f) noteDiagramScalar(Math.hypot(f.x, f.y));
        }
        if (forcePreview?.bodyId === body.id) {
          const { fxN, fyN } = forcePreview;
          noteDiagramScalar(Math.hypot(fxN, fyN));
        }
        if (forceFlash?.bodyId === body.id && forceFlash.alpha > 0.05) {
          const { fxN, fyN } = forceFlash;
          noteDiagramScalar(Math.hypot(fxN, fyN));
        }
        const collListGather = collisions ?? [];
        if (collListGather.length > 0 && gravityForBody && (debug.forceVectors || emphasizeForces)) {
          const wGn = weightNnAtCoM(snapshot, body.id, gravityForBody);
          const apg = appliedForcesNewtons?.get(body.id);
          const estG = estimateContactFrictionNn(
            snapshot,
            body.id,
            collListGather,
            wGn.fx + (apg?.x ?? 0),
            wGn.fy + (apg?.y ?? 0),
            body.velocityX,
            body.velocityY,
          );
          if (estG) {
            noteDiagramScalar(Math.hypot(estG.fnFx, estG.fnFy));
            noteDiagramScalar(Math.hypot(estG.ffFx, estG.ffFy));
          }
        }
      }
      if (debug.velocityVectors) {
        noteDiagramScalar(
          Math.hypot(body.velocityX * VEL_SCALE, body.velocityY * VEL_SCALE),
        );
      }
    }

    const useRelativeDiagram = diagramRelBasis && diagCount > 0;
    const diagramMultiArrow = diagCount >= 2;
    const relLenWorld = useRelativeDiagram
      ? (mag: number) =>
          diagramRelativeArrowWorldLen(mag, diagDenom, diagramMultiArrow, camera.zoom)
      : null;

    if (!body.isStatic && debug.velocityVectors) {
      const vxMs = pxPerSecToMPerSec(body.velocityX);
      const vyMs = pxPerSecToMPerSec(body.velocityY);
      const speedMs = Math.hypot(vxMs, vyMs);
      const speedPx = Math.hypot(body.velocityX, body.velocityY);
      const velScalar =
        Math.hypot(body.velocityX * VEL_SCALE, body.velocityY * VEL_SCALE);
      const vdx =
        relLenWorld !== null && speedPx > 1e-12
          ? (body.velocityX / speedPx) * relLenWorld(velScalar)
          : body.velocityX * VEL_SCALE;
      const vdy =
        relLenWorld !== null && speedPx > 1e-12
          ? (body.velocityY / speedPx) * relLenWorld(velScalar)
          : body.velocityY * VEL_SCALE;
      drawWorldVector(
        ctx,
        body.x,
        body.y,
        vdx,
        vdy,
        "#34d399",
        debug.forceLabels && debug.velocityVectors && speedMs > 0.001
          ? `${speedMs.toFixed(2)} m/s`
          : undefined,
        camera.zoom,
        { dim: 0.85 },
        vectorLabelQueue,
      );
    }

    if (overlayForces) {
      const relOpts = (magN: number) =>
        relLenWorld !== null ? ({ worldArrowLen: relLenWorld(magN) } as const) : {};

      if (showWeight && gravityForBody) {
        const g = gravityForBody(body.id);
        const gxN = approximateNewtonSiFromMatterAppliedForceComponent(g.x, body.mass);
        const gyN = approximateNewtonSiFromMatterAppliedForceComponent(g.y, body.mass);
        const gMag = Math.hypot(gxN, gyN);
        if (gMag > 1e-9) {
          drawForceArrow(
            ctx,
            body.x,
            body.y,
            gxN,
            gyN,
            "weight",
            camera.zoom,
            {
              ...relOpts(gMag),
              label:
                debug.forceLabels && emphasizeForces
                  ? formatForceNMagnitudeAdaptive(gMag)
                  : undefined,
            },
            vectorLabelQueue,
          );
        }
      }

      if (showApplied && appliedForcesNewtons) {
        const f = appliedForcesNewtons.get(body.id);
        if (f) {
          const fMag = Math.hypot(f.x, f.y);
          if (fMag > 1e-9) {
            drawForceArrow(
              ctx,
              body.x,
              body.y,
              f.x,
              f.y,
              "applied",
              camera.zoom,
              {
                ...relOpts(fMag),
                label:
                  debug.forceLabels && emphasizeForces
                    ? formatForceNMagnitudeAdaptive(fMag)
                    : undefined,
              },
              vectorLabelQueue,
            );
          }
        }
      }

      if (!body.isStatic) {
        if (forcePreview?.bodyId === body.id) {
          const { fxN, fyN } = forcePreview;
          const pvMag = Math.hypot(fxN, fyN);
          if (pvMag > 1e-9) {
            drawForceArrow(
              ctx,
              body.x,
              body.y,
              fxN,
              fyN,
              "preview",
              camera.zoom,
              {
                ...relOpts(pvMag),
                label: debug.forceLabels ? formatForceNMagnitudeAdaptive(pvMag) : undefined,
                dashed: true,
              },
              vectorLabelQueue,
            );
          }
        }

        if (forceFlash?.bodyId === body.id && forceFlash.alpha > 0.05) {
          const { fxN, fyN, alpha } = forceFlash;
          const flashMag = Math.hypot(fxN, fyN);
          if (flashMag > 1e-9) {
            drawForceArrow(
              ctx,
              body.x,
              body.y,
              fxN,
              fyN,
              "applied",
              camera.zoom,
              {
                ...relOpts(flashMag),
                label: debug.forceLabels ? formatForceNMagnitudeAdaptive(flashMag) : undefined,
                dim: alpha,
                dashed: true,
              },
              vectorLabelQueue,
            );
          }
        }

        const collList = collisions ?? [];
        if (collList.length > 0 && gravityForBody && (debug.forceVectors || emphasizeForces)) {
          const wNn = weightNnAtCoM(snapshot, body.id, gravityForBody);
          const ap = appliedForcesNewtons?.get(body.id);
          const FxBase = wNn.fx + (ap?.x ?? 0);
          const FyBase = wNn.fy + (ap?.y ?? 0);
          const est = estimateContactFrictionNn(
            snapshot,
            body.id,
            collList,
            FxBase,
            FyBase,
            body.velocityX,
            body.velocityY,
          );
          if (est) {
            const fnMag = Math.hypot(est.fnFx, est.fnFy);
            if (fnMag > 1e-12) {
              drawForceArrow(
                ctx,
                body.x,
                body.y,
                est.fnFx,
                est.fnFy,
                "normal",
                camera.zoom,
                {
                  ...relOpts(fnMag),
                  label:
                    debug.forceLabels && emphasizeForces
                      ? formatForceNMagnitudeAdaptive(fnMag)
                      : undefined,
                },
                vectorLabelQueue,
              );
            }
            const ffMag = Math.hypot(est.ffFx, est.ffFy);
            if (ffMag > 1e-12) {
              drawForceArrow(
                ctx,
                body.x,
                body.y,
                est.ffFx,
                est.ffFy,
                "friction",
                camera.zoom,
                {
                  ...relOpts(ffMag),
                  label:
                    debug.forceLabels && emphasizeForces
                      ? formatForceNMagnitudeAdaptive(ffMag)
                      : undefined,
                },
                vectorLabelQueue,
              );
            }
          }
        }
      }
    }
  }

  for (const rope of snapshot.ropes ?? []) {
    if (!rope.visible) continue;
    const a = snapshot.bodies.find((b) => b.id === rope.bodyA);
    const b = snapshot.bodies.find((b) => b.id === rope.bodyB);
    if (!a?.visible || !b?.visible) continue;

    const pts = ropePolylineFromSnapshot(rope);
    if (pts.length < 2) continue;

    const isSelected = selectedSet.has(rope.id);
    const isHovered = rope.id === hoveredId;
    ctx.strokeStyle = isSelected
      ? "rgba(244,244,245,0.92)"
      : isHovered
        ? "rgba(200,210,220,0.85)"
        : "rgba(150,160,175,0.72)";
    ctx.lineWidth = (isSelected ? 2.2 : 1.35) / camera.zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    strokeSmoothRope(ctx, pts);
    ctx.stroke();
  }

  for (const spring of snapshot.springs) {
    if (!spring.visible) continue;
    const ends = springEndpoints(spring, snapshot);
    if (!ends) continue;

    const isSelected = selectedSet.has(spring.id);
    const isHovered = spring.id === hoveredId;
    const rigid = isRigidBarSpring(spring);
    ctx.strokeStyle = isSelected
      ? rigid
        ? "rgba(226,232,240,0.96)"
        : "rgba(196,181,253,0.95)"
      : isHovered
        ? rigid
          ? "rgba(203,213,225,0.9)"
          : "rgba(167,139,250,0.88)"
        : rigid
          ? "rgba(148,163,184,0.82)"
          : "rgba(140,130,170,0.65)";
    ctx.lineWidth = (rigid ? (isSelected ? 2.8 : 2.1) : isSelected ? 2.2 : 1.35) / camera.zoom;
    if (!rigid) ctx.setLineDash([5 / camera.zoom, 4 / camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(ends.ax, ends.ay);
    ctx.lineTo(ends.bx, ends.by);
    ctx.stroke();
    if (!rigid) ctx.setLineDash([]);
    const r = (isSelected ? 4.5 : 3.5) / camera.zoom;
    ctx.fillStyle = rigid
      ? isSelected
        ? "rgba(226,232,240,0.96)"
        : "rgba(148,163,184,0.9)"
      : isSelected
        ? "rgba(196,181,253,0.95)"
        : "rgba(167,139,250,0.85)";
    for (const p of [
      { x: ends.ax, y: ends.ay },
      { x: ends.bx, y: ends.by },
    ]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (debug.springTension) {
      const mx = (ends.ax + ends.bx) / 2;
      const my = (ends.ay + ends.by) / 2;
      const kNn = elasticKFromSpringSnapshot(spring);
      const grav = gravityForBody ?? ((): { x: number; y: number } => ({ x: 0, y: 0 }));
      const faT = effectiveElasticForceNnOnSelfTowardOther({
        kNnPerMeter: kNn,
        selfX: ends.ax,
        selfY: ends.ay,
        otherX: ends.bx,
        otherY: ends.by,
        restLenPx: spring.length,
        weightNn: weightNnAtCoM(snapshot, spring.bodyA, grav),
      });
      const fbT = effectiveElasticForceNnOnSelfTowardOther({
        kNnPerMeter: kNn,
        selfX: ends.bx,
        selfY: ends.by,
        otherX: ends.ax,
        otherY: ends.ay,
        restLenPx: spring.length,
        weightNn: weightNnAtCoM(snapshot, spring.bodyB, grav),
      });
      const magNn = Math.max(faT.magNn, fbT.magNn);
      const showSpringReadout = isSelected || isHovered || magNn >= 5e-5;
      if (showSpringReadout && debug.forceLabels) {
        ctx.fillStyle = "rgba(251,191,36,0.85)";
        ctx.font = `${9 / camera.zoom}px monospace`;
        ctx.fillText(
          `${formatForceNMagnitudeAdaptive(magNn)} · k=${kNn.toFixed(0)} N/m`,
          mx + 4 / camera.zoom,
          my - 4 / camera.zoom,
        );
      }
    }
  }

  drawSpringElasticForceOverlays(
    ctx,
    snapshot,
    camera.zoom,
    hoveredId,
    debug,
    selectedSet,
    gravityForBody,
    vectorLabelQueue,
  );

  flushVectorLabels(ctx, vectorLabelQueue);

  if (linkPlacementPreview) {
    const { from, to, kind } = linkPlacementPreview;
    ctx.save();
    const rigid = kind === "rigidBar";
    ctx.strokeStyle =
      kind === "rope"
        ? "rgba(148,163,184,0.9)"
        : rigid
          ? "rgba(203,213,225,0.92)"
          : "rgba(167,139,250,0.85)";
    ctx.lineWidth = (rigid ? 2.2 : 1.5) / camera.zoom;
    if (!rigid) ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    if (!rigid) ctx.setLineDash([]);
    const r = 4 / camera.zoom;
    ctx.fillStyle =
      kind === "rope"
        ? "rgba(148,163,184,0.95)"
        : rigid
          ? "rgba(203,213,225,0.95)"
          : "rgba(167,139,250,0.95)";
    for (const p of [from, to]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (peerMarksByEntity && peerMarksByEntity.size > 0) {
    drawPeerSelectionOverlay(ctx, snapshot, peerMarksByEntity, camera.zoom);
  }

  if (transformGizmo) {
    drawTransformGizmo(ctx, transformGizmo, camera.zoom, transformGizmoMode);
  }

  drawSceneMarkups(ctx, snapshot.markups ?? [], camera.zoom, selectedSet);

  if (markupDraft) {
    drawMarkupDraft(
      ctx,
      markupDraft.kind,
      markupDraft.points,
      markupDraft.previewEnd,
      camera.zoom,
    );
  }

  if (selectionMarquee) {
    drawSelectionMarquee(ctx, selectionMarquee, camera.zoom);
  }

  if (measureStart && measureEnd) {
    drawTapeMeasure(ctx, measureStart, measureEnd, measureUnit, camera.zoom);
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

function drawForceArrow(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  fxN: number,
  fyN: number,
  kind: ForceKind,
  zoom: number,
  opts?: {
    label?: string;
    detail?: string;
    dashed?: boolean;
    dim?: number;
    /** When set (emphasized-body diagram mode), skips log remap from magnitude to arrow length. */
    worldArrowLen?: number;
  },
  labelQueue?: QueuedVectorLabel[],
): void {
  const magN = Math.hypot(fxN, fyN);
  if (!(magN > 1e-18)) return;
  const len = opts?.worldArrowLen ?? forceMagNToArrowLen(magN, zoom);
  if (!(len > 1e-20)) return;

  const ux = fxN / magN;
  const uy = fyN / magN;
  const dx = ux * len;
  const dy = uy * len;
  const style = FORCE_KIND_STYLE[kind];
  const alpha = opts?.dim ?? 1;
  const tag = style.tag;
  const mainLabel =
    opts?.label !== undefined ? (opts.label ? `${tag} ${opts.label}` : tag) : undefined;

  drawWorldVector(
    ctx,
    ox,
    oy,
    dx,
    dy,
    style.fill,
    mainLabel,
    zoom,
    {
      stroke: style.stroke,
      glow: style.glow,
      alpha,
      dashed: opts?.dashed,
      sublabel: opts?.detail,
    },
    labelQueue,
  );
}

/** Arrowhead stays ~constant on-screen; avoids huge triangles when zoomed out. */
const HEAD_MIN_SCREEN_PX = 6;
const HEAD_MAX_SCREEN_PX = 11;

type QueuedVectorLabel = {
  tipX: number;
  tipY: number;
  ux: number;
  uy: number;
  label: string;
  color: string;
  sublabel?: string;
  alpha: number;
  zoom: number;
};

type LabelBoxMetrics = {
  boxW: number;
  boxH: number;
  fz: number;
  subFz: number;
  padX: number;
  padY: number;
};

type PlacedLabelRect = { left: number; top: number; right: number; bottom: number };

function measureVectorLabelBox(
  ctx: CanvasRenderingContext2D,
  label: string,
  sublabel: string | undefined,
  zoom: number,
): LabelBoxMetrics {
  const fz = Math.max(11, 12 / zoom);
  const padX = 6 / zoom;
  const padY = 4 / zoom;
  const subFz = sublabel ? Math.max(9, 10 / zoom) : 0;
  const accentPad = 3 / zoom;
  ctx.save();
  ctx.font = `600 ${fz}px ui-sans-serif, system-ui, sans-serif`;
  const mainW = ctx.measureText(label).width;
  let subW = 0;
  if (sublabel) {
    ctx.font = `500 ${subFz}px ui-monospace, monospace`;
    subW = ctx.measureText(sublabel).width;
  }
  ctx.restore();
  return {
    boxW: Math.max(mainW, subW) + padX * 2 + accentPad,
    boxH: fz + padY * 2 + (sublabel ? subFz + padY : 0),
    fz,
    subFz,
    padX: padX + accentPad,
    padY,
  };
}

function labelRectsOverlap(a: PlacedLabelRect, b: PlacedLabelRect, pad: number): boolean {
  return !(
    a.right + pad <= b.left ||
    b.right + pad <= a.left ||
    a.bottom + pad <= b.top ||
    b.bottom + pad <= a.top
  );
}

function defaultLabelAnchor(
  tipX: number,
  tipY: number,
  ux: number,
  uy: number,
  zoom: number,
): { tx: number; ty: number } {
  const along = 14 / zoom;
  const perp = 10 / zoom;
  return {
    tx: tipX + ux * along - uy * perp,
    ty: tipY + uy * along + ux * perp,
  };
}

function paintVectorLabel(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  label: string,
  accentColor: string,
  sublabel: string | undefined,
  alpha: number,
  zoom: number,
  metrics?: LabelBoxMetrics,
): void {
  const m = metrics ?? measureVectorLabelBox(ctx, label, sublabel, zoom);
  const { boxW, boxH, fz, subFz, padX, padY } = m;
  const accentW = 3 / zoom;
  const rx = tx - padX;
  const ry = ty - fz - padY;

  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha + 0.08);

  ctx.fillStyle = "rgba(0,0,0,0.94)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.25 / zoom;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(rx, ry, boxW, boxH, 5 / zoom);
  } else {
    ctx.rect(rx, ry, boxW, boxH);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.fillRect(rx, ry, accentW, boxH);

  ctx.font = `600 ${fz}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 3 / zoom;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineJoin = "round";
  ctx.strokeText(label, tx, ty);
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(label, tx, ty);

  if (sublabel) {
    ctx.font = `500 ${subFz}px ui-monospace, monospace`;
    const subY = ty + subFz + padY * 0.5;
    ctx.strokeText(sublabel, tx, subY);
    ctx.fillStyle = "rgba(226,232,240,0.88)";
    ctx.fillText(sublabel, tx, subY);
  }

  ctx.restore();
}

function flushVectorLabels(ctx: CanvasRenderingContext2D, queue: QueuedVectorLabel[]): void {
  if (queue.length === 0) return;

  const sorted = [...queue].sort((a, b) => a.tipY - b.tipY || a.tipX - b.tipX);
  const placed: PlacedLabelRect[] = [];

  for (const item of sorted) {
    const metrics = measureVectorLabelBox(ctx, item.label, item.sublabel, item.zoom);
    const { tipX, tipY, ux, uy, zoom } = item;
    const along = 14 / zoom;
    const perp0 = 10 / zoom;
    const perpStep = 17 / zoom;

    const candidates: { tx: number; ty: number }[] = [
      defaultLabelAnchor(tipX, tipY, ux, uy, zoom),
    ];
    for (let side = 1; side <= 6; side++) {
      const sign = side % 2 === 1 ? 1 : -1;
      const mag = Math.ceil(side / 2);
      candidates.push({
        tx: tipX + ux * along - uy * (perp0 + sign * mag * perpStep),
        ty: tipY + uy * along + ux * (perp0 + sign * mag * perpStep),
      });
    }
    candidates.push({
      tx: tipX - ux * (10 / zoom) - uy * perp0,
      ty: tipY - uy * (10 / zoom) + ux * perp0,
    });

    const overlapPad = 5 / zoom;
    let chosen = candidates[0];
    let placedRect: PlacedLabelRect = {
      left: chosen.tx - metrics.padX,
      top: chosen.ty - metrics.fz - metrics.padY,
      right: chosen.tx - metrics.padX + metrics.boxW,
      bottom: chosen.ty - metrics.fz - metrics.padY + metrics.boxH,
    };

    for (const c of candidates) {
      const rect: PlacedLabelRect = {
        left: c.tx - metrics.padX,
        top: c.ty - metrics.fz - metrics.padY,
        right: c.tx - metrics.padX + metrics.boxW,
        bottom: c.ty - metrics.fz - metrics.padY + metrics.boxH,
      };
      if (!placed.some((p) => labelRectsOverlap(rect, p, overlapPad))) {
        chosen = c;
        placedRect = rect;
        break;
      }
    }

    placed.push(placedRect);
    paintVectorLabel(
      ctx,
      chosen.tx,
      chosen.ty,
      item.label,
      item.color,
      item.sublabel,
      item.alpha,
      item.zoom,
      metrics,
    );
  }
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
  opts?: {
    stroke?: string;
    glow?: string;
    alpha?: number;
    dashed?: boolean;
    sublabel?: string;
    dim?: number;
  },
  labelQueue?: QueuedVectorLabel[],
): void {
  const mag = Math.hypot(dx, dy);
  const minLen = 6 / zoom;
  if (mag < minLen) return;

  const alpha = (opts?.dim ?? 1) * (opts?.alpha ?? 1);
  const a = Math.atan2(dy, dx);
  const ux = dx / mag;
  const uy = dy / mag;
  const stemMinStub = Math.max(3 / zoom, mag * 0.12);
  const headTarget = Math.min(
    HEAD_MAX_SCREEN_PX / zoom,
    Math.max(HEAD_MIN_SCREEN_PX / zoom, Math.min(mag * 0.42, HEAD_MAX_SCREEN_PX / zoom)),
  );
  const headLen =
    mag > stemMinStub + HEAD_MIN_SCREEN_PX / zoom
      ? Math.min(headTarget, mag - stemMinStub)
      : Math.min(mag * 0.58, HEAD_MAX_SCREEN_PX / zoom);
  const stemX = ox + dx - ux * headLen;
  const stemY = oy + dy - uy * headLen;
  const tipX = ox + dx;
  const tipY = oy + dy;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = alpha;

  if (opts?.glow && mag * zoom > 12) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = 6;
  }

  ctx.strokeStyle = opts?.stroke ?? color;
  ctx.lineWidth = 2.1 / zoom;
  if (opts?.dashed) {
    ctx.setLineDash([7 / zoom, 5 / zoom]);
  }
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(stemX, stemY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - headLen * Math.cos(a - 0.42), tipY - headLen * Math.sin(a - 0.42));
  ctx.lineTo(tipX - headLen * Math.cos(a + 0.42), tipY - headLen * Math.sin(a + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Anchor dot at tail
  ctx.fillStyle = opts?.stroke ?? color;
  ctx.beginPath();
  ctx.arc(ox, oy, 2.5 / zoom, 0, Math.PI * 2);
  ctx.fill();

  if (label) {
    if (labelQueue) {
      labelQueue.push({
        tipX,
        tipY,
        ux,
        uy,
        label,
        color,
        sublabel: opts?.sublabel,
        alpha,
        zoom,
      });
    } else {
      const anchor = defaultLabelAnchor(tipX, tipY, ux, uy, zoom);
      paintVectorLabel(ctx, anchor.tx, anchor.ty, label, color, opts?.sublabel, alpha, zoom);
    }
  }

  ctx.restore();
}

function drawAxisArrowWorld(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  stroke: string,
  fill: string,
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len < 4 / zoom) return;
  const ux = dx / len;
  const uy = dy / len;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.6 / zoom;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  const ah = 11 / zoom;
  const bx = toX - ux * ah;
  const by = toY - uy * ah;
  const px = -uy;
  const py = ux;
  const hw = 4.5 / zoom;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(bx + px * hw, by + py * hw);
  ctx.lineTo(bx - px * hw, by - py * hw);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawTransformGizmo(
  ctx: CanvasRenderingContext2D,
  layout: TransformGizmoLayout,
  zoom: number,
  mode: TransformGizmoMode,
): void {
  const { minX, minY, maxX, maxY } = layout.aabb;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 4 / zoom || h < 4 / zoom) return;

  const lw = mode === "move" ? 1.55 : mode === "rotate" ? 1.35 : 1.35;
  const cornerRScreen = mode === "scale" ? 6 : mode === "move" ? 4 : 4.25;
  const cornerR = cornerRScreen / zoom;

  const strokeMove = "rgba(110,231,183,0.55)";
  const strokeRotate = "rgba(251,191,36,0.75)";
  const strokeScale = "rgba(251,146,60,0.78)";
  const stroke =
    mode === "rotate" ? strokeRotate : mode === "scale" ? strokeScale : strokeMove;
  const fillCorner =
    mode === "scale"
      ? "rgba(251,146,60,0.95)"
      : mode === "move"
        ? "rgba(110,231,183,0.35)"
        : "rgba(251,191,36,0.35)";

  ctx.save();

  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw / zoom;
  ctx.setLineDash(mode === "move" ? [6 / zoom, 4 / zoom] : []);
  ctx.strokeRect(minX, minY, w, h);
  ctx.setLineDash([]);

  ctx.fillStyle =
    mode === "scale"
      ? "rgba(251,146,60,0.06)"
      : mode === "rotate"
        ? "rgba(251,191,36,0.04)"
        : "rgba(110,231,183,0.04)";
  ctx.fillRect(minX, minY, w, h);

  const piv = layout.pivot;
  ctx.strokeStyle =
    mode === "move"
      ? "rgba(248,250,252,0.55)"
      : mode === "rotate"
        ? "rgba(251,191,36,0.55)"
        : "rgba(148,163,184,0.45)";
  ctx.lineWidth = 1.1 / zoom;
  ctx.beginPath();
  ctx.moveTo(piv.x - 10 / zoom, piv.y);
  ctx.lineTo(piv.x + 10 / zoom, piv.y);
  ctx.moveTo(piv.x, piv.y - 10 / zoom);
  ctx.lineTo(piv.x, piv.y + 10 / zoom);
  ctx.stroke();

  if (mode === "move") {
    drawAxisArrowWorld(
      ctx,
      zoom,
      layout.translateX.from.x,
      layout.translateX.from.y,
      layout.translateX.to.x,
      layout.translateX.to.y,
      "rgba(56,189,248,0.95)",
      "rgba(125,211,252,0.95)",
    );
    drawAxisArrowWorld(
      ctx,
      zoom,
      layout.translateY.from.x,
      layout.translateY.from.y,
      layout.translateY.to.x,
      layout.translateY.to.y,
      "rgba(232,121,249,0.92)",
      "rgba(251,207,232,0.92)",
    );
    ctx.fillStyle = "rgba(56,189,248,0.35)";
    ctx.beginPath();
    ctx.arc(layout.translateX.to.x, layout.translateX.to.y, 4 / zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(232,121,249,0.35)";
    ctx.beginPath();
    ctx.arc(layout.translateY.to.x, layout.translateY.to.y, 4 / zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  if (mode === "scale" || mode === "move") {
    for (const k of ["nw", "ne", "se", "sw"] as const) {
      const p = layout.corners[k];
      const dimScale = mode !== "scale";
      ctx.fillStyle = dimScale ? "rgba(148,163,184,0.28)" : fillCorner;
      ctx.strokeStyle = dimScale ? "rgba(226,232,240,0.35)" : "rgba(253,224,171,0.45)";
      ctx.lineWidth = 1.05 / zoom;
      ctx.beginPath();
      ctx.rect(p.x - cornerR, p.y - cornerR, cornerR * 2, cornerR * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (mode === "scale") {
    const gx = strokeScale;
    const er = 5 / zoom;
    for (const p of [layout.edgeScaleEast, layout.edgeScaleSouth]) {
      ctx.strokeStyle = gx;
      ctx.fillStyle = "rgba(253,224,171,0.35)";
      ctx.lineWidth = 1.05 / zoom;
      ctx.beginPath();
      ctx.rect(p.x - er, p.y - er, er * 2, er * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (layout.showRotateHandle && (mode === "rotate" || mode === "move")) {
    const rh = layout.rotateHandle;
    ctx.strokeStyle = mode === "rotate" ? strokeRotate : "rgba(226,232,240,0.28)";
    ctx.lineWidth = 1.05 / zoom;
    ctx.beginPath();
    ctx.moveTo(piv.x, minY);
    ctx.lineTo(rh.x, rh.y);
    ctx.stroke();
    ctx.fillStyle = mode === "rotate" ? "rgba(251,191,36,0.95)" : "rgba(251,191,36,0.25)";
    ctx.beginPath();
    ctx.arc(rh.x, rh.y, 6.5 / zoom, 0, Math.PI * 2);
    ctx.fill();
    if (mode === "rotate") {
      ctx.strokeStyle = "rgba(253,224,171,0.75)";
      ctx.lineWidth = 1.2 / zoom;
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSelectionMarquee(
  ctx: CanvasRenderingContext2D,
  rect: WorldRect,
  zoom: number,
): void {
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  if (w < 2 / zoom && h < 2 / zoom) return;

  ctx.save();
  ctx.fillStyle = "rgba(110, 231, 183, 0.07)";
  ctx.strokeStyle = "rgba(110, 231, 183, 0.55)";
  ctx.lineWidth = 1.25 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.fillRect(rect.minX, rect.minY, w, h);
  ctx.strokeRect(rect.minX, rect.minY, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawWorldGrid(
  ctx: CanvasRenderingContext2D,
  worldW: number,
  worldH: number,
  zoom: number,
): void {
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

  if (zoom >= 0.04) {
    const fontPx = Math.min(14, Math.max(9, 11 / zoom));
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.font = `${fontPx}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    for (let x = major; x < worldW; x += major) {
      ctx.fillText(formatLengthM(pxToM(x), 0), x + 4 / zoom, 4 / zoom);
    }
    for (let y = major; y < worldH; y += major) {
      ctx.fillText(formatLengthM(pxToM(y), 0), 4 / zoom, y + 4 / zoom);
    }
    ctx.restore();
  }
}
