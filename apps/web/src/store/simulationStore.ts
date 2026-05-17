"use client";

import { create } from "zustand";
import { MatterSimulationEngine, type BodyPropsPatch } from "@/lib/physics/matterEngine";
import { DEFAULT_DEBUG_FLAGS, type DebugFlags } from "@/lib/physics/debugTypes";
import { SnapshotBuffer } from "@/lib/physics/snapshotBuffer";
import { resolveAttachPoint, pickDynamicBodyAt } from "@/lib/physics/bodyAttachPoint";
import { pickEntityAt } from "@/lib/physics/selectionUtils";
import type {
  LayerEntity,
  RopeSnapshot,
  SimBodySnapshot,
  SpawnTool,
  SpringPendingAnchor,
  SpringSnapshot,
} from "@/lib/physics/types";
import { logSimAction } from "@/lib/collaboration/logAction";
import { getTestLayout } from "@/lib/physics/testLayouts";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import {
  normalizeStoredScene,
  countSceneObjects,
  toSimulationSnapshot,
  sanitizeSpringPatchForCollab,
  sanitizeRopePatchForCollab,
  sanitizeRopeForCollab,
  type StoredSceneSnapshot,
  type SceneOp,
} from "@/lib/scene/storedScene";
import {
  FLUX_WORLD,
  type SceneCamera,
  initialCameraForViewport,
  cameraFittingAuthoringBodies,
  zoomCameraAtScreen as applyZoomAtScreen,
} from "@/lib/physics/worldSpace";
import { COLLISION_FRAME_WALL_THICKNESS } from "@/lib/physics/physicsConstants";
import {
  idsInMarqueeRect,
  isDraggableBody,
  type WorldRect,
} from "@/lib/physics/selectionUtils";

export type SimSpeed = 0.1 | 0.25 | 0.5 | 1 | 2 | 5;

const SPEEDS: SimSpeed[] = [0.1, 0.25, 0.5, 1, 2, 5];

const history = new SnapshotBuffer();

function isAtLiveEdge(historyIndex: number, len: number): boolean {
  return historyIndex < 0 || (len > 0 && historyIndex >= len - 1);
}

let dragId: string | null = null;
let accumulatedElapsed = 0;

interface GroupDragState {
  anchorId: string;
  pointerStartX: number;
  pointerStartY: number;
  origins: Map<string, { x: number; y: number }>;
  savedMotion: Map<string, { vx: number; vy: number; av: number }>;
}

let groupDrag: GroupDragState | null = null;

function recordFrame(engine: MatterSimulationEngine, dt: number, speed: number): void {
  accumulatedElapsed += dt * speed;
  history.push(engine.snapshot(), accumulatedElapsed);
}

/** Snapshot for timeline frame 0 — authoring layout only, no simulated rope particles. */
function setupKeyframeSnapshot(
  snap: ReturnType<MatterSimulationEngine["snapshot"]>,
): ReturnType<MatterSimulationEngine["snapshot"]> {
  return {
    ...snap,
    tick: 0,
    ropes: (snap.ropes ?? []).map(({ particles: _p, segmentLength: _s, ...r }) => r),
  };
}

/**
 * After setup edits, keep timeline frame 0 in sync with the engine so Live / scrub(0)
 * does not restore a stale scene (missing new bodies, wrong rope state).
 */
function refreshSetupBaseline(engine: MatterSimulationEngine): { truncated: boolean } {
  const truncated = history.length > 1;
  history.updateSetupKeyframe(setupKeyframeSnapshot(engine.snapshot()), {
    truncatePlayback: truncated,
  });
  if (truncated) accumulatedElapsed = 0;
  engine.clearBodyForces();
  engine.resetAllVerletRopes();
  return { truncated };
}

function historyStateAfterBaselineRefresh(truncated: boolean): {
  historyIndex: number;
  historyLength: number;
  elapsedMs: number;
} | null {
  if (!truncated) return null;
  return { historyIndex: -1, historyLength: history.length, elapsedMs: 0 };
}

function applyHistoryIndex(
  engine: MatterSimulationEngine,
  index: number,
): ReturnType<MatterSimulationEngine["snapshot"]> {
  engine.clearBodyForces();

  if (index === 0) {
    const frame = history.getFrame(0);
    if (frame?.full) {
      engine.replaceAuthoringContent(setupKeyframeSnapshot(frame.full));
      engine.setTick(0);
      return engine.snapshot();
    }
    const compact = history.reconstructAt(0);
    engine.restoreCompact(compact);
    engine.resetAllVerletRopes();
    engine.setTick(history.getTick(0));
    return engine.snapshot();
  }

  const compact = history.reconstructAt(index);
  engine.restoreCompact(compact);
  const frame = history.getFrame(index);
  if (frame?.full?.ropes?.length) {
    engine.restoreRopeParticles(frame.full.ropes);
  } else {
    engine.resetAllVerletRopes();
  }
  engine.setTick(history.getTick(index));
  return engine.snapshot();
}

/** Keep Verlet particles aligned with anchor bodies while paused at setup. */
function syncSetupRopes(engine: MatterSimulationEngine, s: SimulationState): void {
  if (s.isPlaying || !isAtSharedSetupFrame(s)) return;
  engine.resetAllVerletRopes();
}

function shouldRefreshSetupBaseline(s: SimulationState): boolean {
  return isAtSharedSetupFrame(s) || s.historyIndex === 0;
}

function clearTimeline(): void {
  history.clear();
  accumulatedElapsed = 0;
}

function buildLayerList(snapshot: ReturnType<MatterSimulationEngine["snapshot"]>): LayerEntity[] {
  const items: LayerEntity[] = [];
  const walls = snapshot.bodies.filter((b) => b.entityKind === "wall");
  const frames = snapshot.bodies.filter((b) => b.entityKind === "collisionBounds");
  const rest = snapshot.bodies.filter(
    (b) =>
      b.entityKind !== "wall" &&
      b.entityKind !== "collisionBounds" &&
      b.entityKind !== "ropeSegment",
  );
  for (const b of [...walls, ...frames, ...rest]) items.push({ type: "body", data: b });
  for (const s of snapshot.springs) items.push({ type: "spring", data: s });
  for (const r of snapshot.ropes ?? []) items.push({ type: "rope", data: r });
  return items;
}

function collaborativeScenePipeline(): {
  sync: boolean;
  sceneRevision: number;
} {
  const m = useRoomSessionStore.getState().membership;
  const epoch = useRoomSessionStore.getState().collabBindingEpoch;
  const store = useRoomSceneCollaborationStore.getState();
  if (m) {
    store.rebindToMembershipIfStale(m, epoch);
  }
  const r = useRoomSceneCollaborationStore.getState();
  const sync =
    !!r.roomId && !!m && m.roomId === r.roomId && (m.role === "admin" || m.role === "member");
  return { sync, sceneRevision: r.sceneRevision };
}

/** Shared room scene may only be edited at timeline frame 0 (setup). Playback is local preview. */
export function isAtSharedSetupFrame(s: { historyIndex: number; historyLength: number }): boolean {
  const { historyIndex, historyLength } = s;
  if (historyLength === 0) return false;
  if (historyIndex === 0) return true;
  if (historyIndex < 0 && historyLength === 1) return true;
  return false;
}

async function pushCollabOp(get: () => SimulationState, op: SceneOp): Promise<void> {
  const { sync } = collaborativeScenePipeline();
  if (!sync || !isAtSharedSetupFrame(get())) return;

  let revision = useRoomSceneCollaborationStore.getState().sceneRevision;
  let result = await useRoomSceneCollaborationStore.getState().commitSceneOp(revision, op);

  if (!result.ok && result.code === "stale_revision") {
    await useRoomSceneCollaborationStore.getState().refreshFromServer();
    revision = useRoomSceneCollaborationStore.getState().sceneRevision;
    result = await useRoomSceneCollaborationStore.getState().commitSceneOp(revision, op);
  }

  if (result.ok) {
    return;
  }
  if ("refreshed" in result && result.refreshed) {
    const { canvasSize } = get();
    get().hydrateFromStoredScene(canvasSize.width, canvasSize.height, result.refreshed, false);
  } else if (process.env.NODE_ENV === "development") {
    console.warn("[flux] scene op failed:", result.code, result.message);
  }
}

interface SimulationState {
  engine: MatterSimulationEngine | null;
  snapshot: ReturnType<MatterSimulationEngine["snapshot"]>;
  layers: LayerEntity[];
  selectedIds: string[];
  selectionAnchorIndex: number;
  hoveredId: string | null;
  activeTool: SpawnTool;
  isPlaying: boolean;
  speed: SimSpeed;
  gravityEnabled: boolean;
  springPending: SpringPendingAnchor | null;
  ropePending: SpringPendingAnchor | null;
  springPreviewEnd: { x: number; y: number } | null;
  debug: DebugFlags;
  canvasSize: { width: number; height: number };
  camera: SceneCamera;
  historyIndex: number;
  historyLength: number;
  elapsedMs: number;
  isScrubbing: boolean;

  initEngine: (width: number, height: number, benchId?: string | null) => void;
  resize: (width: number, height: number) => void;
  tick: (dt: number) => void;
  setPlaying: (v: boolean) => void;
  setSpeed: (s: SimSpeed) => void;
  setTool: (t: SpawnTool) => void;
  selectEntity: (
    id: string,
    opts?: { additive?: boolean; subtract?: boolean; range?: boolean },
  ) => void;
  /** Marquee / bulk select: replace, add (Shift), or subtract (Ctrl). */
  selectEntities: (
    ids: string[],
    mode: "replace" | "add" | "subtract",
  ) => void;
  selectInMarquee: (rect: WorldRect, mode: "replace" | "add") => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;
  toggleGravity: () => void;
  toggleDebug: (key: keyof DebugFlags) => void;
  setDebug: (key: keyof DebugFlags, value: boolean) => void;
  /** Timeline: jump to frame 0 (initial state). */
  resetToFirstFrame: () => void;
  panCameraByScreen: (deltaScreenX: number, deltaScreenY: number) => void;
  zoomCameraAtScreenPoint: (screenX: number, screenY: number, factor: number) => void;
  resetCameraView: () => void;
  spawnAt: (
    x: number,
    y: number,
    opts?: { ctrlKey?: boolean; shiftKey?: boolean },
  ) => void;
  setSpringPreviewEnd: (pt: { x: number; y: number } | null) => void;
  updateSpringPreviewFromPointer: (
    x: number,
    y: number,
    ctrlKey: boolean,
    shiftKey: boolean,
  ) => void;
  updateRopePreviewFromPointer: (
    x: number,
    y: number,
    ctrlKey: boolean,
    shiftKey: boolean,
  ) => void;
  pickAt: (x: number, y: number) => string | null;
  beginDrag: (id: string, pointerX: number, pointerY: number) => void;
  dragTo: (id: string, pointerX: number, pointerY: number) => void;
  endDrag: () => void;
  deleteSelected: () => void;
  renameEntity: (id: string, name: string) => void;
  setEntityVisible: (id: string, visible: boolean) => void;
  updateBody: (
    id: string,
    patch: Partial<SimBodySnapshot>,
    opts?: { commit?: boolean; summary?: string },
  ) => void;
  updateSpring: (
    id: string,
    patch: Partial<Pick<SpringSnapshot, "stiffness" | "damping" | "length">>,
    opts?: { commit?: boolean; summary?: string },
  ) => void;
  updateRope: (
    id: string,
    patch: Partial<Pick<RopeSnapshot, "linkStiffness" | "linkDamping">>,
    opts?: { commit?: boolean; summary?: string },
  ) => void;
  getGravityForce: (id: string) => { x: number; y: number };
  getCollisions: () => ReturnType<MatterSimulationEngine["getCollisionDebugPoints"]>;
  scrubTo: (index: number) => void;
  setScrubbing: (v: boolean) => void;
  stepForward: () => void;
  stepBackward: () => void;
  goLive: () => void;
  hydrateFromStoredScene: (
    width: number,
    height: number,
    stored: StoredSceneSnapshot,
    isPlaying?: boolean,
  ) => void;
  reconcilePausedEngineWithServerSnapshot: (
    stored: StoredSceneSnapshot,
    opts?: { refitCamera?: boolean },
  ) => void;
  /** Clear engine so the next seed/hydrate runs (room or bench switch; global store survives canvas remount). */
  tearDownForRoomChange: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  engine: null,
  snapshot: { bodies: [], springs: [], ropes: [], tick: 0 },
  layers: [],
  selectedIds: [],
  selectionAnchorIndex: -1,
  hoveredId: null,
  activeTool: "select",
  isPlaying: true,
  speed: 1,
  gravityEnabled: true,
  springPending: null,
  ropePending: null,
  springPreviewEnd: null,
  debug: { ...DEFAULT_DEBUG_FLAGS },
  canvasSize: { width: 800, height: 600 },
  camera: initialCameraForViewport(800, 600),
  historyIndex: -1,
  historyLength: 0,
  elapsedMs: 0,
  isScrubbing: false,

  initEngine: (width, height, benchId) => {
    const engine = new MatterSimulationEngine();
    const layout = benchId ? getTestLayout(benchId) : undefined;
    if (layout) {
      engine.seedScenario(layout.build(FLUX_WORLD.WIDTH, FLUX_WORLD.HEIGHT));
    } else {
      engine.seedDemo();
    }
    clearTimeline();
    const snap = engine.snapshot();
    history.push(setupKeyframeSnapshot(snap), 0);
    set({
      engine,
      canvasSize: { width, height },
      camera: cameraFittingAuthoringBodies(snap.bodies, width, height),
      snapshot: snap,
      layers: buildLayerList(snap),
      selectedIds: [],
      selectionAnchorIndex: -1,
      springPending: null,
      ropePending: null,
      historyIndex: -1,
      historyLength: history.length,
      elapsedMs: 0,
    });
  },

  hydrateFromStoredScene: (width, height, stored, isPlayingOverride) => {
    const normalized = normalizeStoredScene(stored);
    const engine = new MatterSimulationEngine();
    engine.seedScenario(toSimulationSnapshot(normalized));
    engine.setGravity(normalized.gravityEnabled !== false);
    clearTimeline();
    const snap = engine.snapshot();
    history.push(setupKeyframeSnapshot(snap), 0);
    set({
      engine,
      canvasSize: { width, height },
      camera: cameraFittingAuthoringBodies(snap.bodies, width, height),
      snapshot: snap,
      layers: buildLayerList(snap),
      selectedIds: [],
      selectionAnchorIndex: -1,
      springPending: null,
      ropePending: null,
      historyIndex: -1,
      historyLength: history.length,
      elapsedMs: 0,
      gravityEnabled: normalized.gravityEnabled !== false,
      isPlaying: isPlayingOverride ?? get().isPlaying,
    });
  },

  reconcilePausedEngineWithServerSnapshot: (stored, opts) => {
    const { engine } = get();
    if (!engine) return;
    const refitCamera = opts?.refitCamera ?? false;
    const normalized = normalizeStoredScene(stored);
    const prevCamera = get().camera;
    engine.seedScenario(toSimulationSnapshot(normalized));
    engine.setGravity(normalized.gravityEnabled !== false);
    clearTimeline();
    const snap = engine.snapshot();
    history.push(setupKeyframeSnapshot(snap), 0);
    const prevSel = get().selectedIds;
    const valid = new Set<string>();
    for (const b of snap.bodies) valid.add(b.id);
    for (const s of snap.springs) valid.add(s.id);
    for (const r of snap.ropes ?? []) valid.add(r.id);
    const selectedIds = prevSel.filter((id) => valid.has(id));
    const { canvasSize } = get();
    set({
      snapshot: snap,
      layers: buildLayerList(snap),
      selectedIds,
      selectionAnchorIndex: selectedIds.length > 0 ? 0 : -1,
      springPending: null,
      ropePending: null,
      historyIndex: -1,
      historyLength: history.length,
      elapsedMs: 0,
      isScrubbing: false,
      isPlaying: false,
      gravityEnabled: normalized.gravityEnabled !== false,
      camera: refitCamera
        ? cameraFittingAuthoringBodies(snap.bodies, canvasSize.width, canvasSize.height)
        : prevCamera,
    });
  },

  tearDownForRoomChange: () => {
    clearTimeline();
    dragId = null;
    groupDrag = null;
    set({
      engine: null,
      snapshot: { bodies: [], springs: [], ropes: [], tick: 0 },
      layers: [],
      selectedIds: [],
      selectionAnchorIndex: -1,
      hoveredId: null,
      springPending: null,
      ropePending: null,
      historyIndex: -1,
      historyLength: 0,
      elapsedMs: 0,
      isScrubbing: false,
      isPlaying: false,
    });
  },

  resize: (width, height) => {
    set({ canvasSize: { width, height } });
  },

  panCameraByScreen: (dx, dy) => {
    const { camera } = get();
    set({
      camera: {
        ...camera,
        centerX: camera.centerX - dx / camera.zoom,
        centerY: camera.centerY - dy / camera.zoom,
      },
    });
  },

  zoomCameraAtScreenPoint: (sx, sy, factor) => {
    const { camera, canvasSize } = get();
    set({
      camera: applyZoomAtScreen(camera, canvasSize.width, canvasSize.height, sx, sy, factor),
    });
  },

  resetCameraView: () => {
    const { canvasSize, snapshot } = get();
    set({
      camera: cameraFittingAuthoringBodies(snapshot.bodies, canvasSize.width, canvasSize.height),
    });
  },

  resetToFirstFrame: () => {
    const { historyLength } = get();
    if (historyLength === 0) return;
    logSimAction("Jump to first frame", "reset", undefined, get().snapshot.tick);
    get().scrubTo(0);
  },

  tick: (dt) => {
    const { engine, isPlaying, speed, historyIndex, isScrubbing } = get();
    if (!engine) return;
    const len = history.length;
    const atLive = isAtLiveEdge(historyIndex, len) && !isScrubbing;

    if (isPlaying && atLive) {
      engine.step(dt, speed);
      if (!dragId) recordFrame(engine, dt, speed);
      const snap = engine.snapshot();
      set({
        snapshot: snap,
        layers: buildLayerList(snap),
        historyIndex: -1,
        historyLength: history.length,
        elapsedMs: accumulatedElapsed,
      });
    }
  },

  setPlaying: (isPlaying) => {
    const state = get();
    const { historyIndex, engine, elapsedMs } = state;
    const atSetup = isAtSharedSetupFrame(state);
    if (engine) {
      if (isPlaying) {
        engine.clearBodyForces();
        if (atSetup || historyIndex === 0) {
          engine.resetAllVerletRopes();
        }
      } else {
        engine.clearBodyForces();
      }
    }
    if (isPlaying && engine && historyIndex >= 0) {
      history.truncateTo(historyIndex);
      accumulatedElapsed = elapsedMs;
      set({ historyIndex: -1, historyLength: history.length });
    }
    set({ isPlaying });
  },

  setSpeed: (speed) => set({ speed }),
  setTool: (activeTool) =>
    set({ activeTool, springPending: null, ropePending: null, springPreviewEnd: null }),

  setSpringPreviewEnd: (springPreviewEnd) => set({ springPreviewEnd }),

  updateSpringPreviewFromPointer: (x, y, ctrlKey, shiftKey) => {
    const { activeTool, springPending, engine } = get();
    if (activeTool !== "spring" || !springPending || !engine) {
      if (get().springPreviewEnd) set({ springPreviewEnd: null });
      return;
    }
    const bodies = engine.snapshot().bodies;
    const hit = pickDynamicBodyAt(bodies, x, y);
    if (hit) {
      const attach = resolveAttachPoint(hit, x, y, {
        snap: !ctrlKey,
        angleSnap: shiftKey,
        angleSnapOrigin: springPending,
      });
      set({ springPreviewEnd: { x: attach.worldX, y: attach.worldY } });
    } else {
      set({ springPreviewEnd: { x, y } });
    }
  },

  updateRopePreviewFromPointer: (x, y, ctrlKey, shiftKey) => {
    const { activeTool, ropePending, engine } = get();
    if (activeTool !== "rope" || !ropePending || !engine) {
      if (get().springPreviewEnd) set({ springPreviewEnd: null });
      return;
    }
    const bodies = engine.snapshot().bodies;
    const hit = pickDynamicBodyAt(bodies, x, y);
    if (hit) {
      const attach = resolveAttachPoint(hit, x, y, {
        snap: !ctrlKey,
        angleSnap: shiftKey,
        angleSnapOrigin: ropePending,
      });
      set({ springPreviewEnd: { x: attach.worldX, y: attach.worldY } });
    } else {
      set({ springPreviewEnd: { x, y } });
    }
  },

  selectEntity: (id, opts) => {
    const { layers, selectedIds, selectionAnchorIndex } = get();
    const layerIds = layers.map((l) => l.data.id);
    const idx = layerIds.indexOf(id);

    if (opts?.range && selectionAnchorIndex >= 0 && idx >= 0) {
      const a = Math.min(selectionAnchorIndex, idx);
      const b = Math.max(selectionAnchorIndex, idx);
      set({ selectedIds: layerIds.slice(a, b + 1) });
      return;
    }

    if (opts?.subtract) {
      set({
        selectedIds: selectedIds.filter((x) => x !== id),
        selectionAnchorIndex: idx >= 0 ? idx : selectionAnchorIndex,
      });
      return;
    }

    if (opts?.additive) {
      if (selectedIds.includes(id)) {
        set({ selectionAnchorIndex: idx >= 0 ? idx : selectionAnchorIndex });
        return;
      }
      set({
        selectedIds: [...selectedIds, id],
        selectionAnchorIndex: idx >= 0 ? idx : selectionAnchorIndex,
      });
      return;
    }

    set({ selectedIds: [id], selectionAnchorIndex: idx >= 0 ? idx : 0 });
  },

  selectEntities: (ids, mode) => {
    const { selectedIds, layers } = get();
    const valid = new Set(layers.map((l) => l.data.id));
    const incoming = ids.filter((id) => valid.has(id));
    let next: string[];
    if (mode === "replace") {
      next = incoming;
    } else if (mode === "add") {
      const setIds = new Set(selectedIds);
      for (const id of incoming) setIds.add(id);
      next = [...setIds];
    } else {
      const remove = new Set(incoming);
      next = selectedIds.filter((id) => !remove.has(id));
    }
    set({ selectedIds: next, selectionAnchorIndex: next.length > 0 ? 0 : -1 });
  },

  selectInMarquee: (rect, mode) => {
    const ids = idsInMarqueeRect(get().snapshot, rect);
    get().selectEntities(ids, mode);
  },

  clearSelection: () => set({ selectedIds: [], selectionAnchorIndex: -1 }),
  setHovered: (hoveredId) => set({ hoveredId }),

  toggleGravity: () => {
    const { engine, gravityEnabled } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    const next = !gravityEnabled;
    engine.setGravity(next);
    set({ gravityEnabled: next });
    void pushCollabOp(get, { type: "scene.gravity", gravityEnabled: next });
  },

  toggleDebug: (key) =>
    set((s) => ({ debug: { ...s.debug, [key]: !s.debug[key] } })),

  setDebug: (key, value) =>
    set((s) => ({ debug: { ...s.debug, [key]: value } })),

  spawnAt: (x, y, opts) => {
    const snapEnabled = !(opts?.ctrlKey ?? false);
    const shiftKey = opts?.shiftKey ?? false;
    const { engine, activeTool, springPending } = get();
    if (!engine) return;

    const { sync } = collaborativeScenePipeline();
    if (sync && !isAtSharedSetupFrame(get())) return;

    const atCap =
      sync &&
      countSceneObjects(get().snapshot) >= useRoomSceneCollaborationStore.getState().objectLimit;

    if (atCap && (activeTool === "circle" || activeTool === "rectangle")) return;

    if (activeTool === "circle") {
      const id = engine.spawnCircle(x, y);
      const baseline =
        shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine) : null;
      const snap = engine.snapshot();
      logSimAction("Spawned circle", "spawn", id, snap.tick);
      const body = snap.bodies.find((b) => b.id === id);
      if (body) void pushCollabOp(get, { type: "entity.add.body", body });
      set({
        selectedIds: [id],
        snapshot: snap,
        layers: buildLayerList(snap),
        ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
      });
      return;
    }
    if (activeTool === "rectangle") {
      const id = engine.spawnRectangle(x, y);
      const baseline =
        shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine) : null;
      const snap = engine.snapshot();
      logSimAction("Spawned box", "spawn", id, snap.tick);
      const body = snap.bodies.find((b) => b.id === id);
      if (body) void pushCollabOp(get, { type: "entity.add.body", body });
      set({
        selectedIds: [id],
        snapshot: snap,
        layers: buildLayerList(snap),
        ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
      });
      return;
    }
    if (activeTool === "collisionBox") {
      const prevId = get().snapshot.bodies.find((b) => b.entityKind === "collisionBounds")?.id;
      const id = engine.spawnCollisionBounds(x, y);
      const baseline =
        shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine) : null;
      const snap = engine.snapshot();
      logSimAction("Placed collision frame", "spawn", id, snap.tick);
      const body = snap.bodies.find((b) => b.id === id);
      if (body) {
        if (prevId && prevId !== id) {
          void pushCollabOp(get, {
            type: "batch",
            ops: [
              { type: "entity.remove", id: prevId },
              { type: "entity.add.body", body },
            ],
          });
        } else {
          void pushCollabOp(get, { type: "entity.add.body", body });
        }
      }
      set({
        selectedIds: [id],
        snapshot: snap,
        layers: buildLayerList(snap),
        ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
      });
      return;
    }
    if (activeTool === "spring") {
      const snap = engine.snapshot();
      const hit = pickDynamicBodyAt(snap.bodies, x, y);
      if (!hit) return;
      const attach = resolveAttachPoint(hit, x, y, { snap: snapEnabled });
      if (!springPending) {
        set({
          springPending: {
            bodyId: hit.id,
            localX: attach.localX,
            localY: attach.localY,
            worldX: attach.worldX,
            worldY: attach.worldY,
          },
          springPreviewEnd: { x: attach.worldX, y: attach.worldY },
          selectedIds: [hit.id],
        });
        return;
      }
      if (springPending.bodyId !== hit.id) {
        if (atCap) return;
        const endAttach = resolveAttachPoint(hit, x, y, {
          snap: snapEnabled,
          angleSnap: shiftKey,
          angleSnapOrigin: springPending,
        });
        const sid = engine.connectSpring(springPending.bodyId, hit.id, {
          pointA: { x: springPending.localX, y: springPending.localY },
          pointB: { x: endAttach.localX, y: endAttach.localY },
        });
        const baseline =
          shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine) : null;
        const next = engine.snapshot();
        logSimAction("Connected spring", "spring", sid ?? undefined, next.tick);
        if (sid) {
          const sp = next.springs.find((s) => s.id === sid);
          if (sp) void pushCollabOp(get, { type: "entity.add.spring", spring: sp });
          set({ selectedIds: [sid] });
        }
        set({
          springPending: null,
          springPreviewEnd: null,
          activeTool: "select",
          snapshot: next,
          layers: buildLayerList(next),
          ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
        });
      }
      return;
    }
    if (activeTool === "rope") {
      const { ropePending } = get();
      const snap = engine.snapshot();
      const hit = pickDynamicBodyAt(snap.bodies, x, y);
      if (!hit) return;
      const attach = resolveAttachPoint(hit, x, y, { snap: snapEnabled });
      if (!ropePending) {
        set({
          ropePending: {
            bodyId: hit.id,
            localX: attach.localX,
            localY: attach.localY,
            worldX: attach.worldX,
            worldY: attach.worldY,
          },
          springPreviewEnd: { x: attach.worldX, y: attach.worldY },
          selectedIds: [hit.id],
        });
        return;
      }
      if (ropePending.bodyId !== hit.id) {
        if (atCap) return;
        const endAttach = resolveAttachPoint(hit, x, y, {
          snap: snapEnabled,
          angleSnap: shiftKey,
          angleSnapOrigin: ropePending,
        });
        const rid = engine.connectRope(ropePending.bodyId, hit.id, {
          pointA: { x: ropePending.localX, y: ropePending.localY },
          pointB: { x: endAttach.localX, y: endAttach.localY },
        });
        const baseline =
          shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine) : null;
        const next = engine.snapshot();
        logSimAction("Connected rope", "rope", rid ?? undefined, next.tick);
        if (rid) {
          const rope = (next.ropes ?? []).find((r) => r.id === rid);
          if (rope) {
            void pushCollabOp(get, {
              type: "entity.add.rope",
              rope: sanitizeRopeForCollab(rope),
            });
            set({ selectedIds: [rid] });
          }
        }
        set({
          ropePending: null,
          springPreviewEnd: null,
          activeTool: "select",
          snapshot: next,
          layers: buildLayerList(next),
          ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
        });
      }
    }
  },

  pickAt: (x, y) => {
    const { snapshot, camera } = get();
    return pickEntityAt(snapshot, x, y, camera.zoom);
  },

  beginDrag: (id, pointerX, pointerY) => {
    const { engine, selectedIds, snapshot } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;

    const body = snapshot.bodies.find((b) => b.id === id);
    if (!body || !isDraggableBody(body)) return;

    const dragTargets = selectedIds.filter((sid) => {
      const b = snapshot.bodies.find((x) => x.id === sid);
      return b && isDraggableBody(b);
    });
    const group =
      dragTargets.length > 1 && dragTargets.includes(id) ? dragTargets : [id];

    dragId = id;
    if (group.length > 1) {
      const origins = new Map<string, { x: number; y: number }>();
      const savedMotion = new Map<string, { vx: number; vy: number; av: number }>();
      for (const bid of group) {
        const b = snapshot.bodies.find((x) => x.id === bid);
        if (b) {
          origins.set(bid, { x: b.x, y: b.y });
          savedMotion.set(bid, {
            vx: b.velocityX,
            vy: b.velocityY,
            av: b.angularVelocity,
          });
        }
      }
      groupDrag = {
        anchorId: id,
        pointerStartX: pointerX,
        pointerStartY: pointerY,
        origins,
        savedMotion,
      };
      const snap = engine.snapshot();
      set({ snapshot: snap, layers: buildLayerList(snap) });
      return;
    }

    groupDrag = null;
    engine.beginDrag(id, pointerX, pointerY);
    const snap = engine.snapshot();
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  dragTo: (id, pointerX, pointerY) => {
    const { engine } = get();
    if (!engine || dragId !== id) return;

    if (groupDrag) {
      const dx = pointerX - groupDrag.pointerStartX;
      const dy = pointerY - groupDrag.pointerStartY;
      for (const [bid, origin] of groupDrag.origins) {
        engine.setBodyPosition(bid, origin.x + dx, origin.y + dy, { zeroVelocity: true });
      }
    } else {
      engine.dragTo(id, pointerX, pointerY);
    }
    syncSetupRopes(engine, get());
    const snap = engine.snapshot();
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  endDrag: () => {
    const { engine, isPlaying, speed, historyIndex, isScrubbing } = get();
    if (!engine) {
      dragId = null;
      groupDrag = null;
      return;
    }
    const draggedId = dragId;
    const group = groupDrag;
    const wasDragging = draggedId !== null;

    if (group) {
      for (const [bid, motion] of group.savedMotion) {
        engine.setBodyMotion(bid, motion.vx, motion.vy, motion.av);
      }
      groupDrag = null;
    } else {
      engine.endDrag();
    }
    dragId = null;

    let baselineTruncated = false;
    if (wasDragging && shouldRefreshSetupBaseline(get())) {
      baselineTruncated = refreshSetupBaseline(engine).truncated;
    } else {
      syncSetupRopes(engine, get());
    }
    const snapAfter = engine.snapshot();

    if (wasDragging && collaborativeScenePipeline().sync && isAtSharedSetupFrame(get())) {
      const patchOps: SceneOp[] = [];
      const idsToCommit = group
        ? [...group.origins.keys()]
        : draggedId
          ? [draggedId]
          : [];
      for (const bid of idsToCommit) {
        const b = snapAfter.bodies.find((x) => x.id === bid);
        if (b && b.entityKind !== "wall" && b.entityKind !== "floor") {
          patchOps.push({
            type: "entity.patch.body",
            id: bid,
            patch: { x: b.x, y: b.y },
          });
        }
      }
      if (patchOps.length === 1) void pushCollabOp(get, patchOps[0]!);
      else if (patchOps.length > 1) void pushCollabOp(get, { type: "batch", ops: patchOps });
    }

    const len = history.length;
    const atLive = isAtLiveEdge(historyIndex, len) && !isScrubbing;
    if (wasDragging && isPlaying && atLive) {
      recordFrame(engine, 16.667, speed);
      const snap = engine.snapshot();
      set({
        snapshot: snap,
        layers: buildLayerList(snap),
        historyIndex: -1,
        historyLength: history.length,
        elapsedMs: accumulatedElapsed,
      });
    } else if (wasDragging) {
      set({
        snapshot: snapAfter,
        layers: buildLayerList(snapAfter),
        ...(baselineTruncated ? historyStateAfterBaselineRefresh(true) : {}),
      });
    }
  },

  deleteSelected: () => {
    const { engine, selectedIds } = get();
    if (!engine || selectedIds.length === 0) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    for (const id of selectedIds) {
      const snapBefore = engine.snapshot();
      if (snapBefore.springs.some((s) => s.id === id)) {
        engine.removeSpring(id);
        continue;
      }
      if ((snapBefore.ropes ?? []).some((r) => r.id === id)) {
        engine.removeRope(id);
        continue;
      }
      if (snapBefore.bodies.some((b) => b.id === id && b.entityKind !== "wall")) {
        engine.removeBody(id);
      }
    }
    const baseline =
      shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine) : null;
    const snap = engine.snapshot();
    logSimAction(`Deleted ${selectedIds.length} object(s)`, "delete", undefined, snap.tick);
    const ops: SceneOp[] = selectedIds.map((id) => ({ type: "entity.remove" as const, id }));
    if (ops.length === 1) void pushCollabOp(get, ops[0]!);
    else if (ops.length > 1) void pushCollabOp(get, { type: "batch", ops });
    set({
      selectedIds: [],
      snapshot: snap,
      layers: buildLayerList(snap),
      ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
    });
  },

  renameEntity: (id, name) => {
    const { engine } = get();
    if (!engine || !name.trim()) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    const trimmed = name.trim();
    engine.renameEntity(id, trimmed);
    const snap = engine.snapshot();
    logSimAction(`Renamed to ${trimmed}`, "rename", id, snap.tick);
    if (snap.springs.some((s) => s.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.spring", id, patch: { displayName: trimmed } });
    } else if ((snap.ropes ?? []).some((r) => r.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.rope", id, patch: { displayName: trimmed } });
    } else {
      void pushCollabOp(get, {
        type: "entity.patch.body",
        id,
        patch: { displayName: trimmed, label: trimmed },
      });
    }
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  setEntityVisible: (id, visible) => {
    const { engine } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    engine.setEntityVisible(id, visible);
    const snap = engine.snapshot();
    logSimAction(visible ? "Showed layer" : "Hidden layer", "visibility", id, snap.tick);
    if (snap.springs.some((s) => s.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.spring", id, patch: { visible } });
    } else if ((snap.ropes ?? []).some((r) => r.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.rope", id, patch: { visible } });
    } else {
      void pushCollabOp(get, { type: "entity.patch.body", id, patch: { visible } });
    }
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  updateBody: (id, patch, opts) => {
    const { engine, snapshot } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    const current = snapshot.bodies.find((b) => b.id === id);
    const props: BodyPropsPatch = {
      mass: patch.mass,
      density: patch.density,
      restitution: patch.restitution,
      friction: patch.friction,
      frictionStatic: patch.frictionStatic,
      frictionAir: patch.frictionAir,
      isStatic: patch.isStatic,
      sleepThreshold: patch.sleepThreshold,
      velocityX: patch.velocityX,
      velocityY: patch.velocityY,
      angularVelocity: patch.angularVelocity,
      gravityScale: patch.gravityScale,
      angle: patch.angle,
    };
    engine.updateBodyProps(id, props);
    if (patch.x !== undefined || patch.y !== undefined) {
      engine.setBodyPosition(
        id,
        patch.x ?? current?.x ?? 0,
        patch.y ?? current?.y ?? 0,
      );
    }
    if (patch.width !== undefined || patch.height !== undefined) {
      engine.setBodyDimensions(
        id,
        patch.width ?? current?.width ?? 48,
        patch.height ?? current?.height ?? 48,
      );
    }
    const baseline =
      shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine) : null;
    syncSetupRopes(engine, get());
    const snap = engine.snapshot();
    const commit = opts?.commit !== false;
    if (commit) {
      logSimAction(opts?.summary ?? "Updated properties", "setComponent", id, snap.tick);
      const p = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<SimBodySnapshot>;
      if (Object.keys(p).length > 0) {
        void pushCollabOp(get, { type: "entity.patch.body", id, patch: p });
      }
    }
    set({
      snapshot: snap,
      layers: buildLayerList(snap),
      ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
    });
  },

  updateSpring: (id, patch, opts) => {
    const { engine } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    engine.updateSpringProps(id, {
      stiffness: patch.stiffness,
      damping: patch.damping,
      length: patch.length,
    });
    const snap = engine.snapshot();
    const commit = opts?.commit !== false;
    if (commit) {
      logSimAction(opts?.summary ?? "Updated spring", "setComponent", id, snap.tick);
      const p = sanitizeSpringPatchForCollab(patch);
      if (Object.keys(p).length > 0) {
        void pushCollabOp(get, { type: "entity.patch.spring", id, patch: p });
      }
    }
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  updateRope: (id, patch, opts) => {
    const { engine } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    engine.updateRopeProps(id, {
      linkStiffness: patch.linkStiffness,
      linkDamping: patch.linkDamping,
    });
    const snap = engine.snapshot();
    const commit = opts?.commit !== false;
    if (commit) {
      logSimAction(opts?.summary ?? "Updated rope", "setComponent", id, snap.tick);
      const p = sanitizeRopePatchForCollab(patch);
      if (Object.keys(p).length > 0) {
        void pushCollabOp(get, { type: "entity.patch.rope", id, patch: p });
      }
    }
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  getGravityForce: (id) => {
    const { engine } = get();
    return engine?.getGravityForceOnBody(id) ?? { x: 0, y: 0 };
  },

  getCollisions: () => {
    const { engine } = get();
    return engine?.getCollisionDebugPoints() ?? [];
  },

  scrubTo: (index) => {
    const { engine, historyLength } = get();
    if (!engine || historyLength === 0) return;
    const clamped = Math.max(0, Math.min(index, historyLength - 1));
    const snap = applyHistoryIndex(engine, clamped);
    const atSetup = isAtSharedSetupFrame({ historyIndex: clamped, historyLength });
    set((state) => ({
      historyIndex: clamped,
      snapshot: snap,
      layers: buildLayerList(snap),
      elapsedMs: history.getElapsedMs(clamped),
      isPlaying: false,
      springPending: atSetup ? state.springPending : null,
      ropePending: atSetup ? state.ropePending : null,
    }));
  },

  setScrubbing: (isScrubbing) => set({ isScrubbing }),

  stepForward: () => {
    const { engine, historyIndex, historyLength, speed } = get();
    if (!engine || historyLength === 0) return;
    const atLive =
      isAtLiveEdge(historyIndex, historyLength) ||
      historyIndex >= historyLength - 1;
    if (atLive) {
      engine.stepOnce(16.667, speed);
      recordFrame(engine, 16.667, speed);
      const snap = engine.snapshot();
      set({
        snapshot: snap,
        layers: buildLayerList(snap),
        historyIndex: -1,
        historyLength: history.length,
        elapsedMs: accumulatedElapsed,
        isPlaying: false,
      });
      return;
    }
    const next = Math.min(historyIndex + 1, historyLength - 1);
    const snap = applyHistoryIndex(engine, next);
    set({
      historyIndex: next,
      snapshot: snap,
      layers: buildLayerList(snap),
      elapsedMs: history.getElapsedMs(next),
      isPlaying: false,
    });
  },

  stepBackward: () => {
    const { engine, historyIndex, historyLength } = get();
    if (!engine || historyLength === 0) return;
    const current = historyIndex < 0 ? historyLength - 1 : historyIndex;
    const prev = Math.max(0, current - 1);
    const snap = applyHistoryIndex(engine, prev);
    set({
      historyIndex: prev,
      snapshot: snap,
      layers: buildLayerList(snap),
      elapsedMs: history.getElapsedMs(prev),
      isPlaying: false,
    });
  },

  /** Frame 0 / setup (authoritative state in rooms). Not “latest physics frame”. */
  goLive: () => {
    const { engine, historyLength } = get();
    if (!engine || historyLength === 0) return;
    set({ isPlaying: false });
    get().scrubTo(0);
  },
}));

export { SPEEDS };
export type { SceneCamera } from "@/lib/physics/worldSpace";

/** Primary selected entity id (first in selection). */
export function usePrimarySelection(): string | null {
  return useSimulationStore((s) => s.selectedIds[0] ?? null);
}
