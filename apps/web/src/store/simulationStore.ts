"use client";

import { create } from "zustand";
import { MatterSimulationEngine, type BodyPropsPatch } from "@/lib/physics/matterEngine";
import { DEFAULT_DEBUG_FLAGS, type DebugFlags } from "@/lib/physics/debugTypes";
import { SnapshotBuffer } from "@/lib/physics/snapshotBuffer";
import type { LayerEntity, SimBodySnapshot, SpawnTool, SpringSnapshot } from "@/lib/physics/types";
import { logSimAction } from "@/lib/collaboration/logAction";
import { getTestLayout } from "@/lib/physics/testLayouts";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import {
  normalizeStoredScene,
  countSceneObjects,
  toSimulationSnapshot,
  sanitizeSpringPatchForCollab,
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

export type SimSpeed = 0.1 | 0.25 | 0.5 | 1 | 2 | 5;

const SPEEDS: SimSpeed[] = [0.1, 0.25, 0.5, 1, 2, 5];

/** Squared distance from P to segment AB (world space). */
function pointToSegmentDistSq(
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
  const nx = ax + t * abx;
  const ny = ay + t * aby;
  const dx = px - nx;
  const dy = py - ny;
  return dx * dx + dy * dy;
}

const history = new SnapshotBuffer();

function isAtLiveEdge(historyIndex: number, len: number): boolean {
  return historyIndex < 0 || (len > 0 && historyIndex >= len - 1);
}

let dragId: string | null = null;
let accumulatedElapsed = 0;

function recordFrame(engine: MatterSimulationEngine, dt: number, speed: number): void {
  accumulatedElapsed += dt * speed;
  history.push(engine.snapshot(), accumulatedElapsed);
}

function applyHistoryIndex(
  engine: MatterSimulationEngine,
  index: number,
): ReturnType<MatterSimulationEngine["snapshot"]> {
  const compact = history.reconstructAt(index);
  engine.restoreCompact(compact);
  engine.setTick(history.getTick(index));
  return engine.snapshot();
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
    (b) => b.entityKind !== "wall" && b.entityKind !== "collisionBounds",
  );
  for (const b of [...walls, ...frames, ...rest]) items.push({ type: "body", data: b });
  for (const s of snapshot.springs) items.push({ type: "spring", data: s });
  return items;
}

function collaborativeScenePipeline(): {
  sync: boolean;
  sceneRevision: number;
} {
  const m = useRoomSessionStore.getState().membership;
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
  const { sync, sceneRevision } = collaborativeScenePipeline();
  if (!sync || !isAtSharedSetupFrame(get())) return;
  const result = await useRoomSceneCollaborationStore.getState().commitSceneOp(sceneRevision, op);
  if (result.ok) {
    // Local engine already reflects this edit (updateBody / updateSpring / …).
    // `commitSceneOp` merged the ack into roomSceneCollaborationStore. Re-seeding here
    // would refit the camera and could clear selection — bad while scrubbing inspector fields.
    return;
  }
  if ("refreshed" in result && result.refreshed) {
    const { canvasSize } = get();
    get().hydrateFromStoredScene(canvasSize.width, canvasSize.height, result.refreshed, false);
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
  springPending: string | null;
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
  selectEntity: (id: string, opts?: { additive?: boolean; range?: boolean }) => void;
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
  spawnAt: (x: number, y: number) => void;
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
  snapshot: { bodies: [], springs: [], tick: 0 },
  layers: [],
  selectedIds: [],
  selectionAnchorIndex: -1,
  hoveredId: null,
  activeTool: "select",
  isPlaying: true,
  speed: 1,
  gravityEnabled: true,
  springPending: null,
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
    history.push(snap, 0);
    set({
      engine,
      canvasSize: { width, height },
      camera: cameraFittingAuthoringBodies(snap.bodies, width, height),
      snapshot: snap,
      layers: buildLayerList(snap),
      selectedIds: [],
      selectionAnchorIndex: -1,
      springPending: null,
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
    history.push(snap, 0);
    set({
      engine,
      canvasSize: { width, height },
      camera: cameraFittingAuthoringBodies(snap.bodies, width, height),
      snapshot: snap,
      layers: buildLayerList(snap),
      selectedIds: [],
      selectionAnchorIndex: -1,
      springPending: null,
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
    history.push(snap, 0);
    const prevSel = get().selectedIds;
    const valid = new Set<string>();
    for (const b of snap.bodies) valid.add(b.id);
    for (const s of snap.springs) valid.add(s.id);
    const selectedIds = prevSel.filter((id) => valid.has(id));
    const { canvasSize } = get();
    set({
      snapshot: snap,
      layers: buildLayerList(snap),
      selectedIds,
      selectionAnchorIndex: selectedIds.length > 0 ? 0 : -1,
      springPending: null,
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
    set({
      engine: null,
      snapshot: { bodies: [], springs: [], tick: 0 },
      layers: [],
      selectedIds: [],
      selectionAnchorIndex: -1,
      hoveredId: null,
      springPending: null,
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
    const { historyIndex, engine, elapsedMs } = get();
    if (isPlaying && engine && historyIndex >= 0) {
      history.truncateTo(historyIndex);
      accumulatedElapsed = elapsedMs;
      set({ historyIndex: -1, historyLength: history.length });
    }
    set({ isPlaying });
  },

  setSpeed: (speed) => set({ speed }),
  setTool: (activeTool) => set({ activeTool, springPending: null }),

  selectEntity: (id, opts) => {
    const { layers, selectedIds, selectionAnchorIndex } = get();
    const layerIds = layers.map((l) => (l.type === "body" ? l.data.id : l.data.id));
    const idx = layerIds.indexOf(id);

    if (opts?.range && selectionAnchorIndex >= 0 && idx >= 0) {
      const a = Math.min(selectionAnchorIndex, idx);
      const b = Math.max(selectionAnchorIndex, idx);
      set({ selectedIds: layerIds.slice(a, b + 1) });
      return;
    }

    if (opts?.additive) {
      const has = selectedIds.includes(id);
      const next = has ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
      set({
        selectedIds: next,
        selectionAnchorIndex: idx >= 0 ? idx : selectionAnchorIndex,
      });
      return;
    }

    set({ selectedIds: [id], selectionAnchorIndex: idx >= 0 ? idx : 0 });
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

  spawnAt: (x, y) => {
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
      const snap = engine.snapshot();
      logSimAction("Spawned circle", "spawn", id, snap.tick);
      const body = snap.bodies.find((b) => b.id === id);
      if (body) void pushCollabOp(get, { type: "entity.add.body", body });
      set({ selectedIds: [id], snapshot: snap, layers: buildLayerList(snap) });
      return;
    }
    if (activeTool === "rectangle") {
      const id = engine.spawnRectangle(x, y);
      const snap = engine.snapshot();
      logSimAction("Spawned box", "spawn", id, snap.tick);
      const body = snap.bodies.find((b) => b.id === id);
      if (body) void pushCollabOp(get, { type: "entity.add.body", body });
      set({ selectedIds: [id], snapshot: snap, layers: buildLayerList(snap) });
      return;
    }
    if (activeTool === "collisionBox") {
      const prevId = get().snapshot.bodies.find((b) => b.entityKind === "collisionBounds")?.id;
      const id = engine.spawnCollisionBounds(x, y);
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
      set({ selectedIds: [id], snapshot: snap, layers: buildLayerList(snap) });
      return;
    }
    if (activeTool === "spring") {
      const hit = engine.snapshot().bodies.find((b) => {
        if (!b.visible) return false;
        const hw = b.width / 2;
        const hh = b.height / 2;
        return (
          x >= b.x - hw &&
          x <= b.x + hw &&
          y >= b.y - hh &&
          y <= b.y + hh &&
          !b.isStatic
        );
      });
      if (!hit) return;
      if (!springPending) {
        set({ springPending: hit.id, selectedIds: [hit.id] });
        return;
      }
      if (springPending !== hit.id) {
        if (atCap) return;
        const sid = engine.connectSpring(springPending, hit.id);
        const snap = engine.snapshot();
        logSimAction("Connected spring", "spring", sid ?? undefined, snap.tick);
        if (sid) {
          const sp = snap.springs.find((s) => s.id === sid);
          if (sp) void pushCollabOp(get, { type: "entity.add.spring", spring: sp });
        }
        set({ springPending: null, snapshot: snap, layers: buildLayerList(snap) });
      }
    }
  },

  pickAt: (x, y) => {
    const { snapshot, camera } = get();
    const hits = snapshot.bodies.filter((b) => {
      if (!b.visible) return false;
      const rim = b.entityKind === "collisionBounds" ? COLLISION_FRAME_WALL_THICKNESS : 0;
      const hw = b.width / 2 + rim;
      const hh = b.height / 2 + rim;
      return x >= b.x - hw && x <= b.x + hw && y >= b.y - hh && y <= b.y + hh;
    });
    const bodyId = hits.length > 0 ? hits[hits.length - 1]!.id : null;
    if (bodyId) return bodyId;

    const pickPx = 14;
    const tolWorld = pickPx / camera.zoom;
    const tolSq = tolWorld * tolWorld;
    let bestSpring: string | null = null;
    let bestD = Infinity;
    for (const sp of snapshot.springs) {
      if (!sp.visible) continue;
      const a = snapshot.bodies.find((b) => b.id === sp.bodyA);
      const b = snapshot.bodies.find((b) => b.id === sp.bodyB);
      if (!a?.visible || !b?.visible) continue;
      const dSq = pointToSegmentDistSq(x, y, a.x, a.y, b.x, b.y);
      if (dSq <= tolSq && dSq < bestD) {
        bestD = dSq;
        bestSpring = sp.id;
      }
    }
    return bestSpring;
  },

  beginDrag: (id, pointerX, pointerY) => {
    const { engine } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    dragId = id;
    engine.beginDrag(id, pointerX, pointerY);
    const snap = engine.snapshot();
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  dragTo: (id, pointerX, pointerY) => {
    const { engine } = get();
    if (!engine || dragId !== id) return;
    engine.dragTo(id, pointerX, pointerY);
    const snap = engine.snapshot();
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  endDrag: () => {
    const { engine, isPlaying, speed, historyIndex, isScrubbing } = get();
    if (!engine) {
      dragId = null;
      return;
    }
    const draggedId = dragId;
    engine.endDrag();
    const wasDragging = draggedId !== null;
    dragId = null;
    const snapAfter = engine.snapshot();

    if (draggedId && collaborativeScenePipeline().sync && isAtSharedSetupFrame(get())) {
      const b = snapAfter.bodies.find((x) => x.id === draggedId);
      if (b && b.entityKind !== "wall" && b.entityKind !== "floor") {
        void pushCollabOp(get, {
          type: "entity.patch.body",
          id: draggedId,
          patch: { x: b.x, y: b.y },
        });
      }
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
    }
  },

  deleteSelected: () => {
    const { engine, selectedIds } = get();
    if (!engine || selectedIds.length === 0) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    for (const id of selectedIds) {
      if (engine.snapshot().bodies.some((b) => b.id === id && b.entityKind !== "wall")) {
        engine.removeBody(id);
      }
    }
    const snap = engine.snapshot();
    logSimAction(`Deleted ${selectedIds.length} object(s)`, "delete", undefined, snap.tick);
    const ops: SceneOp[] = selectedIds.map((id) => ({ type: "entity.remove" as const, id }));
    if (ops.length === 1) void pushCollabOp(get, ops[0]!);
    else if (ops.length > 1) void pushCollabOp(get, { type: "batch", ops });
    set({ selectedIds: [], snapshot: snap, layers: buildLayerList(snap) });
  },

  renameEntity: (id, name) => {
    const { engine } = get();
    if (!engine || !name.trim()) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    engine.renameEntity(id, name.trim());
    const snap = engine.snapshot();
    logSimAction(`Renamed to ${name.trim()}`, "rename", id, snap.tick);
    void pushCollabOp(get, {
      type: "entity.patch.body",
      id,
      patch: { displayName: name.trim(), label: name.trim() },
    });
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  setEntityVisible: (id, visible) => {
    const { engine } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    engine.setEntityVisible(id, visible);
    const snap = engine.snapshot();
    logSimAction(visible ? "Showed layer" : "Hidden layer", "visibility", id, snap.tick);
    void pushCollabOp(get, { type: "entity.patch.body", id, patch: { visible } });
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
    set({ snapshot: snap, layers: buildLayerList(snap) });
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
