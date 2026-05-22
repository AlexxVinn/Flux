"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  authoringTimelineAllowsLayoutEdits,
  buildBodyTrajectoriesForReview,
  isAtSharedSetupFrame,
  useSimulationStore,
} from "@/store/simulationStore";
import { useCollaborationStore } from "@/store/collaborationStore";
import { buildPeerMarksByEntity } from "@/lib/collaboration/peerSelection";
import { renderSimulation } from "@/lib/physics/canvasRenderer";
import { screenToWorld } from "@/lib/physics/worldSpace";
import { worldRectFromPoints, isDraggableBody } from "@/lib/physics/selectionUtils";
import type { MatterSimulationEngine } from "@/lib/physics/matterEngine";
import {
  buildTransformGizmo,
  draggableBodiesFromSelection,
  hitTestTransformGizmo,
  isGizmoCorner,
  unwrapAngleDelta,
} from "@/lib/physics/transformGizmo";
import { PresenceOverlay } from "@/components/collaboration/PresenceOverlay";
import { ForceLegendHud } from "@/components/workspace/ForceLegendHud";
import { useRoomSessionStore, useCanWriteInRoom } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import {
  markLocalSceneRevisionApplied,
  onSimulationEngineReady,
  reconcileEngineWithServer,
} from "@/lib/collaboration/remoteSceneSync";
import { normalizeStoredScene } from "@/lib/scene/storedScene";
import type { BodyShape, SimBodySnapshot } from "@/lib/physics/types";
import type { SimulationQualityMode } from "@/store/simulationStore";

/** Blend toward authoritative body pose each RAF while High quality playback runs (display-only smoothing). */
const PLAYBACK_RENDER_BLEND = 0.58;

function smoothedBodiesForPlayback(
  bodies: SimBodySnapshot[],
  cache: Map<string, { x: number; y: number; angle: number }>,
  blend: number,
): SimBodySnapshot[] {
  const alive = new Set<string>();
  const next = bodies.map((b) => {
    alive.add(b.id);
    if (b.isStatic || b.visible === false) return b;
    const prev = cache.get(b.id);
    if (!prev) {
      const pose = { x: b.x, y: b.y, angle: b.angle };
      cache.set(b.id, pose);
      return b;
    }
    const x = prev.x + (b.x - prev.x) * blend;
    const y = prev.y + (b.y - prev.y) * blend;
    const angle = prev.angle + unwrapAngleDelta(prev.angle, b.angle) * blend;
    cache.set(b.id, { x, y, angle });
    return { ...b, x, y, angle };
  });
  for (const id of cache.keys()) {
    if (!alive.has(id)) cache.delete(id);
  }
  return next;
}

function SimulationQualityHud() {
  const simQuality = useSimulationStore((s) => s.simQuality);
  const setSimulationQuality = useSimulationStore((s) => s.setSimulationQuality);

  const setMode = (mode: SimulationQualityMode) =>
    mode !== simQuality && setSimulationQuality(mode);

  return (
    <div
      role="radiogroup"
      aria-label="Simulation quality"
      className="pointer-events-auto absolute left-3 top-3 z-20 rounded-lg border border-white/[0.08] bg-black/58 px-2 py-1.5 shadow-lg backdrop-blur-sm max-md:left-auto max-md:right-2 max-md:top-2 max-md:scale-90 max-md:origin-top-right"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 font-mono text-[9px] font-medium uppercase tracking-wide text-white/36">
        Quality
      </div>
      <div className="flex gap-px rounded-md bg-white/[0.05] p-px">
        <button
          type="button"
          role="radio"
          aria-checked={simQuality === "standard"}
          title="Balanced solver — lighter CPU usage."
          onClick={() => setMode("standard")}
          className={`rounded-[5px] px-2 py-1 font-mono text-[10px] font-medium outline-none ring-white/35 transition focus-visible:ring-2 ${
            simQuality === "standard"
              ? "bg-white/[0.12] text-white/92"
              : "text-white/45 hover:bg-white/[0.05] hover:text-white/72"
          }`}
        >
          Standard
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={simQuality === "high"}
          title="Tighter collision solver, 2× substeps, display smoothing while playing."
          onClick={() => setMode("high")}
          className={`rounded-[5px] px-2 py-1 font-mono text-[10px] font-medium outline-none ring-white/35 transition focus-visible:ring-2 ${
            simQuality === "high"
              ? "bg-emerald-500/18 text-emerald-100"
              : "text-white/45 hover:bg-white/[0.05] hover:text-white/72"
          }`}
        >
          High
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={simQuality === "max"}
          title="Max realism: 120 Hz fixed physics, 4× substeps, tighter contacts, interpolated render (velocity + pose)."
          onClick={() => setMode("max")}
          className={`rounded-[5px] px-2 py-1 font-mono text-[10px] font-medium outline-none ring-white/35 transition focus-visible:ring-2 ${
            simQuality === "max"
              ? "bg-violet-500/22 text-violet-100"
              : "text-white/45 hover:bg-white/[0.05] hover:text-white/72"
          }`}
        >
          Max
        </button>
      </div>
    </div>
  );
}

interface Objective {
  id: string;
  text: string;
  tip: string;
}

const LAB_OBJECTIVES: Record<string, { title: string; objectives: Objective[] }> = {
  "mechanics-free-fall": {
    title: "Free Fall & Mass",
    objectives: [
      {
        id: "ff_rate",
        text: "Compare free fall rates",
        tip: "Run the simulation. Notice how both the Heavy and Light bodies land simultaneously regardless of mass.",
      },
      {
        id: "ff_rigid",
        text: "Create a linked dynamic drop",
        tip: "Reset simulation, use the Rigid Bar tool (5) to connect both bodies, and observe their coupled motion.",
      },
      {
        id: "ff_height",
        text: "Measure the drop height",
        tip: "Equip the Tape Measure (9), click and drag from the ledge down to the floor to find the distance in meters.",
      },
    ],
  },
  "mechanics-collision-lab": {
    title: "Collision Dynamics",
    objectives: [
      {
        id: "col_elastic",
        text: "Record an elastic rebound",
        tip: "Select the Glider, use the Property Inspector to set its Restitution to 1.0, and watch it bounce elastically.",
      },
      {
        id: "col_heavy",
        text: "Maximize momentum transfer",
        tip: "Double the Glider's mass in the inspector, run physics, and compare the speed transfer of the collision.",
      },
      {
        id: "col_trail",
        text: "Verify the trajectory path",
        tip: "Select the Target, tick 'Show trajectory' in the Property Inspector, scrub the timeline, and view its motion path.",
      },
    ],
  },
  "mechanics-spring-studio": {
    title: "Spring & Oscillations",
    objectives: [
      {
        id: "sp_hooke",
        text: "Find the equilibrium state",
        tip: "Run the simulation, wait for the weight to settle, and note the displacement under gravity.",
      },
      {
        id: "sp_stiff",
        text: "Double spring elasticity (k)",
        tip: "Select the spring constraint, find the elastic constant (k) in the inspector, double it, and observe the faster speed.",
      },
      {
        id: "sp_measure",
        text: "Measure spring expansion",
        tip: "Use the Tape Measure to measure the spring length at rest versus its maximum stretched extension.",
      },
    ],
  },
  "mechanics-starter": {
    title: "Mechanics Fundamentals",
    objectives: [
      {
        id: "st_rigid",
        text: "Construct a rigid linkage",
        tip: "Equip the Rigid Bar tool (5) and connect the floating Body-A directly to the horizontal platform.",
      },
      {
        id: "st_measure",
        text: "Measure platform length",
        tip: "Equip the Tape Measure tool (9), and drag from the left end of the Platform to the right end to measure its length.",
      },
      {
        id: "st_trajectory",
        text: "Track the bouncing trajectory",
        tip: "Select Body-A, enable 'Show trajectory' in the inspector, let it swing, and view the precise white path.",
      },
    ],
  },
};

function LabObjectivesHud() {
  const membership = useRoomSessionStore((s) => s.membership);
  const slug = membership?.slug || "";

  // Find if there's an active lab matching the slug, or fallback to mechanics-starter
  const labKey = Object.keys(LAB_OBJECTIVES).find((k) => slug.includes(k)) || "mechanics-starter";
  const lab = LAB_OBJECTIVES[labKey]!;

  const storageKey = `flux_completed_obj_${labKey}`;
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setCompleted(JSON.parse(saved));
      } else {
        setCompleted({});
      }
    } catch {
      setCompleted({});
    }
  }, [storageKey]);

  const toggleObjective = (id: string) => {
    const next = { ...completed, [id]: !completed[id] };
    setCompleted(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className="pointer-events-auto w-full rounded-lg border border-white/[0.08] bg-black/75 p-2.5 shadow-lg backdrop-blur-md transition-all duration-200"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-1.5">
        <span className="font-sans text-[11px] font-semibold text-white/90">
          🎯 {lab.title} Objectives
        </span>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-white/40 hover:text-white/80"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="text-[10px] leading-snug text-white/45 mb-1">
            Complete active challenges inside this physics playground.
          </p>
          <ul className="flex flex-col gap-1.5">
            {lab.objectives.map((obj) => {
              const isDone = !!completed[obj.id];
              return (
                <li
                  key={obj.id}
                  className="group flex flex-col rounded bg-white/[0.02] p-1.5 transition hover:bg-white/[0.05]"
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => toggleObjective(obj.id)}
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-white/20 bg-black text-emerald-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span
                      className={`text-[10.5px] leading-snug transition-all ${
                        isDone ? "text-emerald-400/70 line-through" : "text-white/75 group-hover:text-white"
                      }`}
                    >
                      {obj.text}
                    </span>
                  </label>
                  <p className="mt-1 pl-5.5 font-sans text-[9px] leading-relaxed text-white/40 group-hover:text-white/55">
                    {obj.tip}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

type RotateGestureState = {
  kind: "rotate";
  ids: string[];
  pivotX: number;
  pivotY: number;
  startAngleRad: number;
  base: Record<string, { x: number; y: number; angle: number }>;
};

type TranslateAxisGestureState = {
  kind: "translate-axis";
  axis: "x" | "y";
  ids: string[];
  pointerStartWorld: { x: number; y: number };
  origins: Record<string, { x: number; y: number }>;
};

type ScaleGestureState = {
  kind: "scale";
  scheme: "uniform" | "x" | "y";
  ids: string[];
  pivotX: number;
  pivotY: number;
  /** Radial uniform scale */
  startDist: number;
  /** Cursor at pointer down (world) — axis ratios use deltas from pivot */
  pointerStartWorld: { x: number; y: number };
  spanXRef: number;
  spanYRef: number;
  sMin: number;
  base: Record<string, { x: number; y: number; width: number; height: number; shape: BodyShape }>;
};

type ActiveTransformGizmo = RotateGestureState | TranslateAxisGestureState | ScaleGestureState;

function applyRotateGesture(
  engine: MatterSimulationEngine,
  g: RotateGestureState,
  worldX: number,
  worldY: number,
  snap15Deg = false,
): void {
  const cur = Math.atan2(worldY - g.pivotY, worldX - g.pivotX);
  let d = unwrapAngleDelta(g.startAngleRad, cur);
  if (snap15Deg) {
    const step = Math.PI / 12; // 15 degrees
    d = Math.round(d / step) * step;
  }
  const cos = Math.cos(d);
  const sin = Math.sin(d);
  for (const id of g.ids) {
    const b0 = g.base[id];
    if (!b0) continue;
    const dx = b0.x - g.pivotX;
    const dy = b0.y - g.pivotY;
    const nx = g.pivotX + dx * cos - dy * sin;
    const ny = g.pivotY + dx * sin + dy * cos;
    engine.setBodyPosition(id, nx, ny, { zeroVelocity: true });
    engine.updateBodyProps(id, { angle: b0.angle + d });
  }
}

function applyTranslateAxisGesture(
  engine: MatterSimulationEngine,
  g: TranslateAxisGestureState,
  worldX: number,
  worldY: number,
): void {
  let dx = g.axis === "x" ? worldX - g.pointerStartWorld.x : 0;
  let dy = g.axis === "y" ? worldY - g.pointerStartWorld.y : 0;
  const gridSnap = useSimulationStore.getState().gridSnapEnabled;

  for (const id of g.ids) {
    const o = g.origins[id];
    if (!o) continue;
    let nx = o.x + dx;
    let ny = o.y + dy;
    if (gridSnap) {
      nx = Math.round(nx / 10) * 10;
      ny = Math.round(ny / 10) * 10;
    }
    engine.setBodyPosition(id, nx, ny, { zeroVelocity: true });
  }
}

function applyScaleGesture(
  engine: MatterSimulationEngine,
  g: ScaleGestureState,
  worldX: number,
  worldY: number,
): void {
  if (g.scheme === "uniform") {
    const dx = worldX - g.pivotX;
    const dy = worldY - g.pivotY;
    const raw = Math.hypot(dx, dy) / Math.max(g.startDist, 1e-9);
    const s = Math.min(80, Math.max(g.sMin, raw));
    for (const id of g.ids) {
      const b0 = g.base[id];
      if (!b0) continue;
      const nx = g.pivotX + (b0.x - g.pivotX) * s;
      const ny = g.pivotY + (b0.y - g.pivotY) * s;
      engine.setBodyPosition(id, nx, ny, { zeroVelocity: true });
      engine.setBodyDimensions(id, b0.width * s, b0.height * s);
    }
    return;
  }

  const tiny = Math.max(g.spanXRef, g.spanYRef) * 1e-4 + 1e-9;

  if (g.scheme === "x") {
    let dStart = g.pointerStartWorld.x - g.pivotX;
    if (Math.abs(dStart) < tiny) {
      const sign = dStart >= 0 ? 1 : -1;
      dStart = sign * g.spanXRef;
    }
    const rx = Math.min(80, Math.max(g.sMin, (worldX - g.pivotX) / dStart));
    for (const id of g.ids) {
      const b0 = g.base[id];
      if (!b0) continue;
      const nx = g.pivotX + rx * (b0.x - g.pivotX);
      engine.setBodyPosition(id, nx, b0.y, { zeroVelocity: true });
      if (b0.shape === "circle") {
        const d = Math.max(b0.width, b0.height) * rx;
        engine.setBodyDimensions(id, d, d);
      } else {
        engine.setBodyDimensions(id, b0.width * rx, b0.height);
      }
    }
    return;
  }

  /** scale-y */
  let dSy = g.pointerStartWorld.y - g.pivotY;
  if (Math.abs(dSy) < tiny) {
    const sign = dSy >= 0 ? 1 : -1;
    dSy = sign * g.spanYRef;
  }
  const ry = Math.min(80, Math.max(g.sMin, (worldY - g.pivotY) / dSy));
  for (const id of g.ids) {
    const b0 = g.base[id];
    if (!b0) continue;
    const ny = g.pivotY + ry * (b0.y - g.pivotY);
    engine.setBodyPosition(id, b0.x, ny, { zeroVelocity: true });
    if (b0.shape === "circle") {
      const d = Math.max(b0.width, b0.height) * ry;
      engine.setBodyDimensions(id, d, d);
    } else {
      engine.setBodyDimensions(id, b0.width, b0.height * ry);
    }
  }
}

interface PhysicsCanvasProps {
  benchId?: string | null;
  /** When set, seeds Matter from this snapshot instead of room RPC or bench demo. */
  initialStoredScene?: import("@/lib/scene/storedScene").StoredSceneSnapshot | null;
}

export function PhysicsCanvas({ benchId = null, initialStoredScene = null }: PhysicsCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const initEngine = useSimulationStore((s) => s.initEngine);
  const hydrateFromStoredScene = useSimulationStore((s) => s.hydrateFromStoredScene);
  const resize = useSimulationStore((s) => s.resize);
  const tick = useSimulationStore((s) => s.tick);
  const selectedIds = useSimulationStore((s) => s.selectedIds);
  const activeTool = useSimulationStore((s) => s.activeTool);
  const debug = useSimulationStore((s) => s.debug);
  const selectEntity = useSimulationStore((s) => s.selectEntity);
  const selectInMarquee = useSimulationStore((s) => s.selectInMarquee);
  const clearSelection = useSimulationStore((s) => s.clearSelection);
  const spawnAt = useSimulationStore((s) => s.spawnAt);
  const pickAt = useSimulationStore((s) => s.pickAt);
  const beginDrag = useSimulationStore((s) => s.beginDrag);
  const dragTo = useSimulationStore((s) => s.dragTo);
  const endDrag = useSimulationStore((s) => s.endDrag);
  const authoringSyncFromEngine = useSimulationStore((s) => s.authoringSyncFromEngine);
  const finalizeAuthoringBodyTransforms = useSimulationStore((s) => s.finalizeAuthoringBodyTransforms);
  const panCameraByScreen = useSimulationStore((s) => s.panCameraByScreen);

  const sendCursor = useCollaborationStore((s) => s.sendCursor);
  const sendSelection = useCollaborationStore((s) => s.sendSelection);
  const markupTool = useSimulationStore((s) => s.activeMarkupTool);
  const markupDraftPoints = useSimulationStore((s) => s.markupDraftPoints);
  const markupPreviewEnd = useSimulationStore((s) => s.markupPreviewEnd);
  const addMarkupDraftPoint = useSimulationStore((s) => s.addMarkupDraftPoint);
  const clearMarkupDraft = useSimulationStore((s) => s.clearMarkupDraft);
  const setMarkupPreviewEnd = useSimulationStore((s) => s.setMarkupPreviewEnd);
  const addSceneMarkup = useSimulationStore((s) => s.addSceneMarkup);
  const canWrite = useCanWriteInRoom();

  const dragTargetRef = useRef<string | null>(null);
  const lastCursorSendRef = useRef(0);
  const isPanningRef = useRef(false);
  const isMeasuringRef = useRef(false);
  const panLastClientRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<{
    startWorld: { x: number; y: number };
    currentWorld: { x: number; y: number };
    startScreen: { x: number; y: number };
    mode: "replace" | "add";
  } | null>(null);
  const activeTransformGizmoRef = useRef<ActiveTransformGizmo | null>(null);
  /** Display-only smoothed poses during live playback (High quality mode). Not used for authoritative state. */
  const playbackSmoothRef = useRef(new Map<string, { x: number; y: number; angle: number }>());

  const MARQUEE_THRESHOLD_PX = 4;

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { width: 800, height: 600 };
    const { width, height } = el.getBoundingClientRect();
    return { width: Math.floor(width), height: Math.floor(height) };
  }, []);

  const membership = useRoomSessionStore((s) => s.membership);
  const supabaseConnected = useCollaborationStore((s) => s.supabaseConnected);
  const collabRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const sceneRevision = useRoomSceneCollaborationStore((s) => s.sceneRevision);

  /** Apply remote scene revisions to Matter as soon as the collab store advances. */
  useEffect(() => {
    if (!collabRoomId || collabRoomId !== membership?.roomId) return;
    if (!supabaseConnected) return;
    if (!useSimulationStore.getState().engine) return;
    void reconcileEngineWithServer({ refitCamera: false, force: false });
  }, [sceneRevision, collabRoomId, membership?.roomId, supabaseConnected]);

  useEffect(() => {
    sendSelection(selectedIds);
  }, [selectedIds, sendSelection]);
  const seedLayoutKeyRef = useRef<{ roomId: string | undefined; benchKey: string | null } | null>(
    null,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const roomId = membership?.roomId;
    const benchKey = benchId ?? null;
    const prev = seedLayoutKeyRef.current;
    if (prev !== null && (prev.roomId !== roomId || prev.benchKey !== benchKey)) {
      useSimulationStore.getState().tearDownForRoomChange();
    }
    seedLayoutKeyRef.current = { roomId, benchKey };

    let cancelled = false;

    const seedEngine = async (w: number, h: number) => {
      if (w < 8 || h < 8) return;

      if (initialStoredScene) {
        hydrateFromStoredScene(w, h, initialStoredScene, false);
        setSize({ width: w, height: h });
        return;
      }

      const expectedRoomId = membership?.roomId ?? null;

      if (expectedRoomId && supabaseConnected) {
        const collab = useRoomSceneCollaborationStore.getState();
        const snap = collab.lastServerSnapshot;
        if (snap) {
          hydrateFromStoredScene(w, h, snap, false);
          markLocalSceneRevisionApplied(collab.sceneRevision, expectedRoomId);
        } else {
          hydrateFromStoredScene(
            w,
            h,
            normalizeStoredScene({ bodies: [], springs: [], ropes: [] }),
            false,
          );
        }
        onSimulationEngineReady();
      } else {
        initEngine(w, h, benchId);
      }
      setSize({ width: w, height: h });
    };

    const ro = new ResizeObserver(() => {
      const { width, height } = measure();
      const hasEngine = useSimulationStore.getState().engine !== null;
      if (!hasEngine) {
        void seedEngine(width, height);
      } else {
        resize(width, height);
        setSize({ width, height });
      }
    });

    ro.observe(el);

    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      const { width, height } = measure();
      if (useSimulationStore.getState().engine === null) {
        await seedEngine(width, height);
      }
    })();

    return () => {
      cancelled = true;
      ro.disconnect();
      useSimulationStore.getState().tearDownForRoomChange();
    };
  }, [
    benchId,
    hydrateFromStoredScene,
    initEngine,
    measure,
    membership?.roomId,
    resize,
    supabaseConnected,
    initialStoredScene,
  ]);

  useEffect(() => {
    const loop = (now: number) => {
      const dt = lastRef.current ? now - lastRef.current : 16;
      lastRef.current = now;
      tick(dt);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const el = containerRef.current;
      if (!ctx || !canvas || !el) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const { width, height } = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const sim = useSimulationStore.getState();
      const smoothingLive =
        sim.isPlaying && sim.historyIndex < 0 && !sim.isScrubbing;

      let snapshotForRender = sim.snapshot;
      if (smoothingLive && sim.simQuality === "max" && sim.engine) {
        snapshotForRender = sim.engine.interpolateSnapshotForRender(
          sim.snapshot,
          sim.physicsRenderAlpha,
        );
      } else if (smoothingLive && sim.simQuality === "high") {
        snapshotForRender = {
          ...sim.snapshot,
          bodies: smoothedBodiesForPlayback(
            sim.snapshot.bodies,
            playbackSmoothRef.current,
            PLAYBACK_RENDER_BLEND,
          ),
        };
      } else {
        playbackSmoothRef.current.clear();
      }

      const collab = useCollaborationStore.getState();
      const peerMarksByEntity = buildPeerMarksByEntity(
        collab.peers,
        snapshotForRender,
        collab.userId,
      );
      const marquee = marqueeRef.current;
      const selectionMarquee = marquee
        ? worldRectFromPoints(
            marquee.startWorld.x,
            marquee.startWorld.y,
            marquee.currentWorld.x,
            marquee.currentWorld.y,
          )
        : null;

      const previewEnd = sim.springPreviewEnd;
      const linkPlacementPreview = (() => {
        if (!previewEnd) return null;
        if (sim.springPending) {
          return {
            from: { x: sim.springPending.worldX, y: sim.springPending.worldY },
            to: previewEnd,
            kind: sim.activeTool === "rigidBar" ? ("rigidBar" as const) : ("spring" as const),
          };
        }
        if (sim.ropePending) {
          return {
            from: { x: sim.ropePending.worldX, y: sim.ropePending.worldY },
            to: previewEnd,
            kind: "rope" as const,
          };
        }
        return null;
      })();

      const forcePreview =
        sim.activeTool === "force" && sim.selectedIds[0]
          ? {
              bodyId: sim.selectedIds[0],
              fxN: sim.forceFxN,
              fyN: sim.forceFyN,
            }
          : null;

      const forceFlash = (() => {
        const flash = sim.forceFlash;
        if (!flash) return null;
        const remaining = flash.untilMs - performance.now();
        if (remaining <= 0) return null;
        return {
          bodyId: flash.bodyId,
          fxN: flash.fxN,
          fyN: flash.fyN,
          alpha: Math.min(1, remaining / 900),
        };
      })();

      const authoringSurface =
        canWrite && sim.engine !== null && authoringTimelineAllowsLayoutEdits(sim);
      const transformTargets =
        sim.activeTool === "select"
          ? draggableBodiesFromSelection(sim.snapshot, sim.selectedIds)
          : [];
      const transformGizmoOverlay =
        authoringSurface && transformTargets.length > 0
          ? buildTransformGizmo(transformTargets, sim.camera.zoom)
          : null;

      const bodyTrajectories = buildBodyTrajectoriesForReview(
        snapshotForRender.bodies,
        sim.historyLength,
        sim.historyIndex,
      );

      renderSimulation(ctx, snapshotForRender, {
        width,
        height,
        camera: sim.camera,
        selectedIds: sim.selectedIds,
        hoveredId: sim.hoveredId,
        debug: sim.debug,
        gravityForBody: sim.getGravityForce,
        appliedForcesNewtons: sim.getUserSustainedForcesNewtons(),
        forcePreview,
        forceFlash,
        collisions: sim.getCollisions(),
        selectionMarquee,
        peerMarksByEntity,
        linkPlacementPreview,
        transformGizmo: transformGizmoOverlay,
        transformGizmoMode: sim.transformGizmoMode,
        bodyTrajectories,
        measureStart: sim.measureStart,
        measureEnd: sim.measureEnd,
        measureUnit: sim.measureUnit,
        markupDraft:
          sim.activeMarkupTool && sim.markupDraftPoints.length > 0
            ? {
                kind: sim.activeMarkupTool,
                points: sim.markupDraftPoints,
                previewEnd: sim.markupPreviewEnd,
              }
            : null,
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick, canWrite]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const factor = ev.deltaY > 0 ? 0.9 : 1.1;
      useSimulationStore.getState().zoomCameraAtScreenPoint(sx, sy, factor);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let lastPinchDist = 0;
    let lastMid = { x: 0, y: 0 };

    const touchMid = (t0: Touch, t1: Touch, rect: DOMRect) => ({
      x: (t0.clientX + t1.clientX) / 2 - rect.left,
      y: (t0.clientY + t1.clientY) / 2 - rect.top,
    });

    const touchDist = (t0: Touch, t1: Touch) =>
      Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length !== 2) return;
      const rect = canvas.getBoundingClientRect();
      lastPinchDist = touchDist(ev.touches[0]!, ev.touches[1]!);
      lastMid = touchMid(ev.touches[0]!, ev.touches[1]!, rect);
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches.length !== 2 || lastPinchDist <= 0) return;
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dist = touchDist(ev.touches[0]!, ev.touches[1]!);
      const mid = touchMid(ev.touches[0]!, ev.touches[1]!, rect);
      const factor = Math.min(1.12, Math.max(0.88, dist / lastPinchDist));
      useSimulationStore.getState().zoomCameraAtScreenPoint(mid.x, mid.y, factor);
      useSimulationStore.getState().panCameraByScreen(mid.x - lastMid.x, mid.y - lastMid.y);
      lastPinchDist = dist;
      lastMid = mid;
    };

    const onTouchEnd = () => {
      lastPinchDist = 0;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const canvasPointer = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      screen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      vw: rect.width,
      vh: rect.height,
    };
  };

  const pointerToWorld = (
    screen: { x: number; y: number },
    vw: number,
    vh: number,
  ) => {
    const { camera } = useSimulationStore.getState();
    return screenToWorld(screen.x, screen.y, vw, vh, camera);
  };

  const handleMarkupClick = (pt: { x: number; y: number }) => {
    if (!markupTool || !canWrite) return false;

    if (markupTool === "text") {
      const text = window.prompt("Label text", "Note") ?? "Note";
      addSceneMarkup("text", [pt], text);
      clearMarkupDraft();
      return true;
    }

    if (markupDraftPoints.length === 0) {
      addMarkupDraftPoint(pt);
      return true;
    }

    const start = markupDraftPoints[0]!;
    addSceneMarkup(markupTool, [start, pt]);
    clearMarkupDraft();
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      panLastClientRef.current = { x: e.clientX, y: e.clientY };
      canvasRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const cp = canvasPointer(e);
    if (!cp) return;
    canvasRef.current?.setPointerCapture(e.pointerId);

    const pt = pointerToWorld(cp.screen, cp.vw, cp.vh);

    if (markupTool) {
      handleMarkupClick(pt);
      return;
    }

    if (activeTool === "force") {
      const hit = pickAt(pt.x, pt.y);
      if (hit) selectEntity(hit);
      return;
    }

    if (activeTool === "measure") {
      useSimulationStore.getState().setMeasureStart(pt);
      useSimulationStore.getState().setMeasureEnd(pt);
      isMeasuringRef.current = true;
      return;
    }

    if (activeTool !== "select") {
      if (canWrite) {
        spawnAt(pt.x, pt.y, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
      }
      return;
    }

    const sim = useSimulationStore.getState();
    const canEdit =
      canWrite &&
      (!membership?.roomId ||
        isAtSharedSetupFrame({
          historyIndex: sim.historyIndex,
          historyLength: sim.historyLength,
        }));

    const subtract = e.ctrlKey;
    const additive = (e.shiftKey || e.metaKey) && !subtract;

    const targets = draggableBodiesFromSelection(sim.snapshot, sim.selectedIds);
    const layout =
      authoringTimelineAllowsLayoutEdits(sim) && targets.length > 0
        ? buildTransformGizmo(targets, sim.camera.zoom)
        : null;

    if (canEdit && layout) {
      const gzHit = hitTestTransformGizmo(pt.x, pt.y, sim.camera.zoom, layout, sim.transformGizmoMode);
      if (gzHit === "rotate") {
        const rotateBodies = targets.filter((b) => b.entityKind !== "collisionBounds");
        if (rotateBodies.length > 0) {
          const base: RotateGestureState["base"] = {};
          for (const b of rotateBodies) {
            base[b.id] = { x: b.x, y: b.y, angle: b.angle };
          }
          const { x: pivotX, y: pivotY } = layout.pivot;
          activeTransformGizmoRef.current = {
            kind: "rotate",
            ids: rotateBodies.map((b) => b.id),
            pivotX,
            pivotY,
            startAngleRad: Math.atan2(pt.y - pivotY, pt.x - pivotX),
            base,
          };
          return;
        }
      } else if (sim.transformGizmoMode === "scale" && gzHit) {
        const { x: pivotX, y: pivotY } = layout.pivot;
        const base: ScaleGestureState["base"] = {};
        for (const b of targets) {
          base[b.id] = { x: b.x, y: b.y, width: b.width, height: b.height, shape: b.shape };
        }

        if (isGizmoCorner(gzHit)) {
          let sMin = 0.05;
          for (const b of targets) {
            sMin = Math.max(
              sMin,
              8 / Math.max(b.width, 1e-9),
              8 / Math.max(b.height, 1e-9),
            );
          }
          const startDist = Math.max(Math.hypot(pt.x - pivotX, pt.y - pivotY), 1e-9);
          activeTransformGizmoRef.current = {
            kind: "scale",
            scheme: "uniform",
            ids: targets.map((b) => b.id),
            pivotX,
            pivotY,
            startDist,
            pointerStartWorld: { x: pt.x, y: pt.y },
            spanXRef: layout.spanX,
            spanYRef: layout.spanY,
            sMin,
            base,
          };
          return;
        }
        if (gzHit === "scale-x") {
          let sMin = 0.05;
          for (const b of targets) {
            const ref = b.shape === "circle" ? Math.max(b.width, b.height) : b.width;
            sMin = Math.max(sMin, 8 / Math.max(ref, 1e-9));
          }
          activeTransformGizmoRef.current = {
            kind: "scale",
            scheme: "x",
            ids: targets.map((b) => b.id),
            pivotX,
            pivotY,
            startDist: 1,
            pointerStartWorld: { x: pt.x, y: pt.y },
            spanXRef: layout.spanX,
            spanYRef: layout.spanY,
            sMin,
            base,
          };
          return;
        }
        if (gzHit === "scale-y") {
          let sMin = 0.05;
          for (const b of targets) {
            const ref = b.shape === "circle" ? Math.max(b.width, b.height) : b.height;
            sMin = Math.max(sMin, 8 / Math.max(ref, 1e-9));
          }
          activeTransformGizmoRef.current = {
            kind: "scale",
            scheme: "y",
            ids: targets.map((b) => b.id),
            pivotX,
            pivotY,
            startDist: 1,
            pointerStartWorld: { x: pt.x, y: pt.y },
            spanXRef: layout.spanX,
            spanYRef: layout.spanY,
            sMin,
            base,
          };
          return;
        }
      } else if (gzHit === "translate-x" || gzHit === "translate-y") {
        const origins: TranslateAxisGestureState["origins"] = {};
        for (const b of targets) {
          origins[b.id] = { x: b.x, y: b.y };
        }
        activeTransformGizmoRef.current = {
          kind: "translate-axis",
          axis: gzHit === "translate-x" ? "x" : "y",
          ids: targets.map((b) => b.id),
          pointerStartWorld: { x: pt.x, y: pt.y },
          origins,
        };
        return;
      }
    }

    const hit = pickAt(pt.x, pt.y);

    if (!hit) {
      marqueeRef.current = {
        startWorld: pt,
        currentWorld: pt,
        startScreen: cp.screen,
        mode: additive ? "add" : "replace",
      };
      return;
    }

    if (subtract) {
      selectEntity(hit, { subtract: true });
    } else if (additive) {
      selectEntity(hit, { additive: true });
    } else if (!sim.selectedIds.includes(hit)) {
      selectEntity(hit);
    }

    const body = sim.snapshot.bodies.find((b) => b.id === hit);
    if (canEdit && body && isDraggableBody(body)) {
      dragTargetRef.current = hit;
      beginDrag(hit, pt.x, pt.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isPanningRef.current && panLastClientRef.current) {
      const prev = panLastClientRef.current;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      panLastClientRef.current = { x: e.clientX, y: e.clientY };
      panCameraByScreen(dx, dy);
      return;
    }

    const cp = canvasPointer(e);
    if (!cp) return;
    const pt = pointerToWorld(cp.screen, cp.vw, cp.vh);

    if (activeTool === "measure" && isMeasuringRef.current) {
      useSimulationStore.getState().setMeasureEnd(pt);
      return;
    }

    const now = performance.now();

    if (now - lastCursorSendRef.current > 50) {
      lastCursorSendRef.current = now;
      sendCursor(pt);
    }

    if (markupTool && markupDraftPoints.length === 1) {
      setMarkupPreviewEnd(pt);
      return;
    }

    const marquee = marqueeRef.current;
    if (marquee) {
      marquee.currentWorld = pt;
      return;
    }

    const gizmoGesture = activeTransformGizmoRef.current;
    const en = useSimulationStore.getState().engine;
    if (gizmoGesture && en) {
      if (gizmoGesture.kind === "rotate") {
        applyRotateGesture(en, gizmoGesture, pt.x, pt.y, e.shiftKey);
      } else if (gizmoGesture.kind === "translate-axis") {
        applyTranslateAxisGesture(en, gizmoGesture, pt.x, pt.y);
      } else {
        applyScaleGesture(en, gizmoGesture, pt.x, pt.y);
      }
      authoringSyncFromEngine();
      return;
    }

    const id = dragTargetRef.current;
    if (id) {
      dragTo(id, pt.x, pt.y);
      return;
    }

    const simState = useSimulationStore.getState();
    if (
      (simState.activeTool === "spring" || simState.activeTool === "rigidBar") &&
      simState.springPending
    ) {
      simState.updateSpringPreviewFromPointer(pt.x, pt.y, e.ctrlKey, e.shiftKey);
    } else if (simState.activeTool === "rope" && simState.ropePending) {
      simState.updateRopePreviewFromPointer(pt.x, pt.y, e.ctrlKey, e.shiftKey);
    }

    if (activeTool !== "select") return;
    const hit = pickAt(pt.x, pt.y);
    useSimulationStore.getState().setHovered(hit);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button === 1) {
      isPanningRef.current = false;
      panLastClientRef.current = null;
    }

    if (isMeasuringRef.current) {
      isMeasuringRef.current = false;
    }

    const marquee = marqueeRef.current;
    if (marquee) {
      const cp = canvasPointer(e);
      if (cp) {
        const end = pointerToWorld(cp.screen, cp.vw, cp.vh);
        const dx = cp.screen.x - marquee.startScreen.x;
        const dy = cp.screen.y - marquee.startScreen.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= MARQUEE_THRESHOLD_PX) {
          const rect = worldRectFromPoints(
            marquee.startWorld.x,
            marquee.startWorld.y,
            end.x,
            end.y,
          );
          selectInMarquee(rect, marquee.mode);
        } else if (marquee.mode === "replace") {
          clearSelection();
        }
      }
      marqueeRef.current = null;
    }

    const gesture = activeTransformGizmoRef.current;
    activeTransformGizmoRef.current = null;
    dragTargetRef.current = null;
    if (gesture) {
      finalizeAuthoringBodyTransforms(gesture.ids);
    }
    endDrag();
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const onPointerLeave = () => {
    if (!dragTargetRef.current && !activeTransformGizmoRef.current) {
      useSimulationStore.getState().setHovered(null);
    }
  };

  const showForceLegend =
    debug.forceVectors && debug.gravityVectors && debug.forceLabels;

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 bg-black">
      <SimulationQualityHud />
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex w-[260px] max-w-[calc(100%-1rem)] flex-col gap-2 max-md:right-2 max-md:top-12 max-md:w-[min(240px,calc(100%-1rem))]">
        {showForceLegend && <ForceLegendHud />}
        <LabObjectivesHud />
      </div>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${
          activeTool === "select" && !markupTool ? "cursor-default" : "cursor-crosshair"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      <PresenceOverlay width={size.width} height={size.height} />
    </div>
  );
}
