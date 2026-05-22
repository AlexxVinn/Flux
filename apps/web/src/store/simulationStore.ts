"use client";

import { create } from "zustand";
import { MatterSimulationEngine, type BodyPropsPatch } from "@/lib/physics/matterEngine";
import { DEFAULT_DEBUG_FLAGS, type DebugFlags } from "@/lib/physics/debugTypes";
import { SnapshotBuffer } from "@/lib/physics/snapshotBuffer";
import { resolveAttachPoint, pickDynamicBodyAt } from "@/lib/physics/bodyAttachPoint";
import { pickEntityAt } from "@/lib/physics/selectionUtils";
import {
  attachMarkupsToSnapshot,
  mergeEngineSnapshotWithDocument,
} from "@/lib/physics/sceneMarkups";
import { nextMarkupName } from "@/lib/physics/entityNames";
import type {
  CollisionDebugPoint,
  LayerEntity,
  RopeSnapshot,
  SceneMarkupKind,
  SceneMarkupSnapshot,
  SimulationSnapshot,
  SimBodySnapshot,
  SpawnTool,
  SpringPendingAnchor,
  SpringSnapshot,
  ForceApplicationMode,
} from "@/lib/physics/types";
import { logSimAction } from "@/lib/collaboration/logAction";
import {
  clearPendingRemoteSceneApply,
  flushDeferredRemoteSceneApply,
} from "@/lib/collaboration/remoteSceneSync";
import { getTestLayout } from "@/lib/physics/testLayouts";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import {
  normalizeStoredScene,
  countSceneObjects,
  toSimulationSnapshot,
  snapshotForServer,
  sanitizeSpringPatchForCollab,
  sanitizeRopePatchForCollab,
  sanitizeRopeForCollab,
  sanitizeMarkupForCollab,
  sanitizeMarkupPatchForCollab,
  applySceneOpToStoredSnapshot,
  type StoredSceneSnapshot,
  type SceneOp,
} from "@/lib/scene/storedScene";
import { authoringUndoStack } from "@/lib/scene/authoringHistory";
import { authoringUndoDebugLog } from "@/lib/scene/authoringHistoryDebug";
import type { AuthoringClipboardFragment } from "@/lib/scene/selectionClipboard";
import {
  DUPLICATE_CLUSTER_OFFSET_PX,
  extractAuthoringClipboard,
  instantiatePasteOnEngine,
  PASTE_OFFSET_PX,
  remapClipboardForPaste,
} from "@/lib/scene/selectionClipboard";
import {
  FLUX_WORLD,
  type SceneCamera,
  initialCameraForViewport,
  cameraFittingAuthoringBodies,
  zoomCameraAtScreen as applyZoomAtScreen,
} from "@/lib/physics/worldSpace";
import { COLLISION_FRAME_WALL_THICKNESS } from "@/lib/physics/physicsConstants";
import type { TransformGizmoMode } from "@/lib/physics/transformGizmo";
import {
  idsInMarqueeRect,
  isDraggableBody,
  type WorldRect,
} from "@/lib/physics/selectionUtils";

import {
  approximateNewtonSiFromMatterAppliedForceComponent,
  pxPerSecToMPerSec,
  pxToM,
} from "@/lib/physics/units";
import { estimateContactFrictionNn } from "@/lib/physics/contactFrictionEstimate";
import { sumSpringElasticForcesNnOnBody } from "@/lib/physics/forceInspect";
import {
  getSimulationQualityPreset,
  type SimulationQualityMode,
} from "@/lib/physics/simulationQuality";
import {
  causalSmoothVelocityMs,
  TELEMETRY_VELOCITY_SMOOTH_TAU_MS,
  windowedKinematicVelocityMs,
  zeroPhaseSmoothVelocitySeries,
} from "@/lib/physics/motionTelemetrySmoothing";

export type { SimulationQualityMode } from "@/lib/physics/simulationQuality";

export type SimSpeed = 0.1 | 0.25 | 0.5 | 1 | 2 | 5;

const SPEEDS: SimSpeed[] = [0.1, 0.25, 0.5, 1, 2, 5];

const history = new SnapshotBuffer();

let skipAuthoringHistoryRecord = false;

function canRecordAuthoringHistoryCheckpoint(state: SimulationState): boolean {
  if (!state.engine || state.isPlaying) return false;
  const { sync } = collaborativeScenePipeline();
  if (!sync) return true;
  return isAtSharedSetupFrame(state);
}

function describeAuthoringUndoBlock(state: SimulationState): string | null {
  if (!state.engine) return "no_engine";
  if (state.isPlaying) return "is_playing";
  if (!authoringUndoStack.canUndo()) return `stack_canUndo=false(${authoringUndoStack.getDebugCounts().entryCount} entries)`;
  return null;
}

function recordAuthoringHistoryCheckpoint(get: () => SimulationState): void {
  if (skipAuthoringHistoryRecord) return;
  const st = get();
  if (!canRecordAuthoringHistoryCheckpoint(st)) {
    authoringUndoDebugLog(
      "record_skip",
      `blocked: playing=${st.isPlaying} setup=${isAtSharedSetupFrame(st)} engine=${!!st.engine}`,
    );
    return;
  }
  authoringUndoStack.pushFromSimulation(st.snapshot, st.gravityEnabled);
  authoringUndoDebugLog("record", `after edit · ${authoringUndoStack.getDebugCounts().entryCount} entries`);
}

function resetAuthoringHistoryFromState(get: () => SimulationState, stored?: StoredSceneSnapshot): void {
  if (stored) {
    authoringUndoStack.reset(normalizeStoredScene(stored));
    authoringUndoDebugLog("reset", "from stored snapshot");
    return;
  }
  const st = get();
  if (!st.engine) {
    authoringUndoStack.reset();
    authoringUndoDebugLog("reset", "no engine");
    return;
  }
  authoringUndoStack.reset(snapshotForServer(st.snapshot, st.gravityEnabled));
  authoringUndoDebugLog("reset", "from live engine");
}

function isAtLiveEdge(historyIndex: number, len: number): boolean {
  return historyIndex < 0 || (len > 0 && historyIndex >= len - 1);
}

let dragId: string | null = null;
let accumulatedElapsed = 0;
/** Fixed-timestep accumulator for Max quality (ms). */
let physicsFixedAccumulator = 0;

function resetPhysicsFixedAccumulator(): void {
  physicsFixedAccumulator = 0;
}

interface GroupDragState {
  anchorId: string;
  pointerStartX: number;
  pointerStartY: number;
  origins: Map<string, { x: number; y: number }>;
  savedMotion: Map<string, { vx: number; vy: number; av: number }>;
}

let groupDrag: GroupDragState | null = null;

interface MarkupDragState {
  anchorId: string;
  pointerStartX: number;
  pointerStartY: number;
  origins: Map<string, { x: number; y: number }[]>;
}

let markupDrag: MarkupDragState | null = null;

/** Matter physics + document markups; never clobber store physics with an empty engine read. */
function engSnap(
  prev: SimulationSnapshot,
  engineSnap: SimulationSnapshot,
): SimulationSnapshot {
  return mergeEngineSnapshotWithDocument(prev, engineSnap);
}

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
function refreshSetupBaseline(
  engine: MatterSimulationEngine,
  prev: SimulationSnapshot,
): { truncated: boolean } {
  const truncated = history.length > 1;
  const snap = mergeEngineSnapshotWithDocument(prev, engine.snapshot());
  snap.markups = prev.markups ?? [];
  history.updateSetupKeyframe(setupKeyframeSnapshot(snap), {
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
  engine.clearUserSustainedForces();

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
  resetPhysicsFixedAccumulator();
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
  for (const m of snapshot.markups ?? []) items.push({ type: "markup", data: m });
  return items;
}

/** Timeline gate for authoring layout transforms at rest (paired with write permission separately). */
export function authoringTimelineAllowsLayoutEdits(
  state: Pick<SimulationState, "engine" | "isPlaying" | "historyIndex" | "historyLength">,
): boolean {
  return !!(
    state.engine &&
    !state.isPlaying &&
    (!collaborativeScenePipeline().sync || isAtSharedSetupFrame(state))
  );
}

/** Setup-time structural edits: local room always; collab rooms only shared frame 0. None while playback runs. */
function canAuthorStructuralEdits(state: SimulationState): boolean {
  return authoringTimelineAllowsLayoutEdits(state);
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
    const refreshed = normalizeStoredScene(result.refreshed);
    const prev = get().snapshot;
    const prevObjects = countSceneObjects(prev);
    const refreshedObjects = countSceneObjects(refreshed);
    if (refreshedObjects === 0 && prevObjects > 0) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[flux] ignored server refresh with empty scene (would wipe local physics)");
      }
      return;
    }
    get().reconcilePausedEngineWithServerSnapshot(refreshed, {
      refitCamera: false,
      resetAuthoringHistory: true,
    });
  } else if (process.env.NODE_ENV === "development") {
    console.warn("[flux] scene op failed:", result.code, result.message);
  }
}

/** Time-series playback samples for charts (selection must be one dynamic body). */
export interface SelectionTelemetrySample {
  elapsedMs: number;
  bodyId: string;
  xM: number;
  yM: number;
  vxMs: number;
  vyMs: number;
  axMs2: number;
  ayMs2: number;
  rXN: number;
  rYN: number;
  rMagN: number;
}

/** One kinematic sample from the recorded timeline (frames 0 .. review frame). Used by Graphs tab. */
export interface MotionTimelineGraphPoint {
  elapsedMs: number;
  frameIndex: number;
  xM: number;
  yM: number;
  vxMs: number;
  vyMs: number;
  axMs2: number;
  ayMs2: number;
}

/**
 * Reconstructs SI motion samples from the playback buffer up to the current review head.
 * Acceleration uses Δv/Δt between adjacent recorded frames (always uses full resolution before downsampling).
 */
export function buildMotionTimelineSamplesForSelection(
  bodyId: string,
  historyLength: number,
  historyIndex: number,
): MotionTimelineGraphPoint[] {
  if (historyLength <= 0) return [];
  const lastFrame = historyLength - 1;
  const endIdx =
    historyIndex >= 0 ? Math.min(historyIndex, lastFrame) : lastFrame;

  type RawPt = Omit<MotionTimelineGraphPoint, "vxMs" | "vyMs" | "axMs2" | "ayMs2">;
  const raw: RawPt[] = [];
  for (let i = 0; i <= endIdx; i++) {
    const compact = history.reconstructAt(i);
    const b = compact.find((x) => x.id === bodyId);
    if (!b) continue;
    raw.push({
      elapsedMs: history.getElapsedMs(i),
      frameIndex: i,
      xM: pxToM(b.x),
      yM: pxToM(b.y),
    });
  }
  if (raw.length === 0) return [];

  const vxRaw = raw.map((_, i) => windowedKinematicVelocityMs(raw, i).vxMs);
  const vyRaw = raw.map((_, i) => windowedKinematicVelocityMs(raw, i).vyMs);
  const elapsed = raw.map((p) => p.elapsedMs);
  const { vxMs: vxSmooth, vyMs: vySmooth } = zeroPhaseSmoothVelocitySeries(
    vxRaw,
    vyRaw,
    elapsed,
    TELEMETRY_VELOCITY_SMOOTH_TAU_MS,
  );

  const withVelocity = raw.map((cur, i) => ({
    ...cur,
    vxMs: vxSmooth[i]!,
    vyMs: vySmooth[i]!,
  }));

  const full: MotionTimelineGraphPoint[] = withVelocity.map((cur, i) => {
    let ax = 0;
    let ay = 0;
    if (i > 0) {
      const prev = withVelocity[i - 1]!;
      const dtSec = Math.max(1e-4, (cur.elapsedMs - prev.elapsedMs) / 1000);
      ax = (cur.vxMs - prev.vxMs) / dtSec;
      ay = (cur.vyMs - prev.vyMs) / dtSec;
    } else if (withVelocity.length > 1) {
      const next = withVelocity[1]!;
      const dtSec = Math.max(1e-4, (next.elapsedMs - cur.elapsedMs) / 1000);
      ax = (next.vxMs - cur.vxMs) / dtSec;
      ay = (next.vyMs - cur.vyMs) / dtSec;
    }
    return { ...cur, axMs2: ax, ayMs2: ay };
  });

  const MAX = 520;
  if (full.length <= MAX) return full;
  const out: MotionTimelineGraphPoint[] = [];
  const n = full.length;
  for (let u = 0; u < MAX; u++) {
    const idx = u === MAX - 1 ? n - 1 : Math.floor((u / (MAX - 1)) * (n - 1));
    out.push(full[idx]!);
  }
  return out;
}

export interface BodyTrajectoryOverlay {
  bodyId: string;
  points: { x: number; y: number }[];
}

const TRAJECTORY_BODY_KINDS = new Set([
  "circle",
  "rectangle",
  "body",
]);

/** Playback paths in world px, truncated to the current timeline review head. */
export function buildBodyTrajectoriesForReview(
  bodies: SimBodySnapshot[],
  historyLength: number,
  historyIndex: number,
): BodyTrajectoryOverlay[] {
  if (historyLength <= 1) return [];

  const eligible = bodies.filter(
    (b) =>
      b.showTrajectory &&
      b.visible !== false &&
      !b.isStatic &&
      TRAJECTORY_BODY_KINDS.has(b.entityKind),
  );
  if (eligible.length === 0) return [];

  const lastFrame = historyLength - 1;
  const endIdx = historyIndex >= 0 ? Math.min(historyIndex, lastFrame) : lastFrame;
  const paths = history.buildTrajectoriesForBodies(
    eligible.map((b) => b.id),
    endIdx,
  );

  const overlays: BodyTrajectoryOverlay[] = [];
  for (const b of eligible) {
    const points = paths.get(b.id) ?? [];
    if (points.length >= 2) overlays.push({ bodyId: b.id, points });
  }
  return overlays;
}

const TELEMETRY_MAX_SAMPLES = 500;

/** Primary selection tracked for resetting derivative + ring buffer. */
let telemetryTrackedPrimary: string | null = null;
let telemetryAccelPrimed = false;
let telemetryPrevVxMs = 0;
let telemetryPrevVyMs = 0;
let telemetryPrevXM = 0;
let telemetryPrevYM = 0;
let telemetryPrevElapsedMs = 0;
/** Causal velocity low-pass state for live telemetry ring buffer. */
let telemetrySmoothVxMs = 0;
let telemetrySmoothVyMs = 0;
let telemetrySmoothPrimed = false;

function resetTelemetryDerivativeState(): void {
  telemetryAccelPrimed = false;
  telemetryPrevVxMs = 0;
  telemetryPrevVyMs = 0;
  telemetryPrevXM = 0;
  telemetryPrevYM = 0;
  telemetryPrevElapsedMs = 0;
  telemetrySmoothVxMs = 0;
  telemetrySmoothVyMs = 0;
  telemetrySmoothPrimed = false;
}

function rawKinematicVelocityMsForTelemetry(
  xM: number,
  yM: number,
  accumulatedMs: number,
  body: { velocityX: number; velocityY: number },
  useKinematic: boolean,
): { vxMs: number; vyMs: number } {
  if (useKinematic && telemetryAccelPrimed) {
    const dtSec = Math.max(1e-4, (accumulatedMs - telemetryPrevElapsedMs) / 1000);
    return {
      vxMs: (xM - telemetryPrevXM) / dtSec,
      vyMs: (yM - telemetryPrevYM) / dtSec,
    };
  }
  return {
    vxMs: pxPerSecToMPerSec(body.velocityX),
    vyMs: pxPerSecToMPerSec(body.velocityY),
  };
}

function syncTelemetryToPrimarySelection(
  selectedIds: string[],
  storeSet: (
    partial: Partial<SimulationState> | ((state: SimulationState) => Partial<SimulationState>),
  ) => void,
): void {
  const primary = selectedIds[0] ?? null;
  const prev = telemetryTrackedPrimary;
  telemetryTrackedPrimary = primary;
  if (prev !== primary) {
    resetTelemetryDerivativeState();
    storeSet({ selectionTelemetrySamples: [] });
  }
}

function finalizePlaybackTelemetrySample(
  snapshot: ReturnType<MatterSimulationEngine["snapshot"]>,
  collisions: CollisionDebugPoint[],
  accumulatedMs: number,
  getState: () => SimulationState,
  storeSet: (partial: Partial<SimulationState> | ((s: SimulationState) => Partial<SimulationState>)) => void,
): void {
  const st = getState();
  if (!st.isPlaying) return;

  const id = st.selectedIds[0];
  const body = id ? snapshot.bodies.find((b) => b.id === id) : undefined;
  if (!id || !body || body.isStatic || body.entityKind === "ropeSegment") return;

  const g = st.getGravityForce(id);
  const gxN = approximateNewtonSiFromMatterAppliedForceComponent(g.x, body.mass);
  const gyN = approximateNewtonSiFromMatterAppliedForceComponent(g.y, body.mass);
  const apl = st.getUserSustainedForcesNewtons().get(id);
  const apXN = apl?.x ?? 0;
  const apYN = apl?.y ?? 0;

  const spr = sumSpringElasticForcesNnOnBody(snapshot, id, (bid) => st.getGravityForce(bid));
  const cf = estimateContactFrictionNn(snapshot, id, collisions, gxN + apXN, gyN + apYN, body.velocityX, body.velocityY);
  const fnx = cf?.fnFx ?? 0;
  const fny = cf?.fnFy ?? 0;
  const ffx = cf?.ffFx ?? 0;
  const ffy = cf?.ffFy ?? 0;

  const Rx = gxN + apXN + spr.fx + fnx + ffx;
  const Ry = gyN + apYN + spr.fy + fny + ffy;

  const xM = pxToM(body.x);
  const yM = pxToM(body.y);
  const useKinematic = st.simQuality === "max";

  const rawV = rawKinematicVelocityMsForTelemetry(
    xM,
    yM,
    accumulatedMs,
    body,
    useKinematic,
  );

  let vxMs = rawV.vxMs;
  let vyMs = rawV.vyMs;
  if (useKinematic) {
    if (!telemetrySmoothPrimed) {
      telemetrySmoothVxMs = rawV.vxMs;
      telemetrySmoothVyMs = rawV.vyMs;
      telemetrySmoothPrimed = true;
    } else if (telemetryAccelPrimed) {
      const dtMs = Math.max(0, accumulatedMs - telemetryPrevElapsedMs);
      const sm = causalSmoothVelocityMs(
        rawV.vxMs,
        rawV.vyMs,
        telemetrySmoothVxMs,
        telemetrySmoothVyMs,
        dtMs,
        TELEMETRY_VELOCITY_SMOOTH_TAU_MS,
      );
      telemetrySmoothVxMs = sm.vxMs;
      telemetrySmoothVyMs = sm.vyMs;
    }
    vxMs = telemetrySmoothVxMs;
    vyMs = telemetrySmoothVyMs;
  }

  let axMs2 = 0;
  let ayMs2 = 0;

  if (!telemetryAccelPrimed) {
    telemetryAccelPrimed = true;
    telemetryPrevVxMs = vxMs;
    telemetryPrevVyMs = vyMs;
    telemetryPrevXM = xM;
    telemetryPrevYM = yM;
    telemetryPrevElapsedMs = accumulatedMs;
  } else {
    const dtSec = Math.max(1e-4, (accumulatedMs - telemetryPrevElapsedMs) / 1000);
    axMs2 = (vxMs - telemetryPrevVxMs) / dtSec;
    ayMs2 = (vyMs - telemetryPrevVyMs) / dtSec;
    telemetryPrevVxMs = vxMs;
    telemetryPrevVyMs = vyMs;
    telemetryPrevXM = xM;
    telemetryPrevYM = yM;
    telemetryPrevElapsedMs = accumulatedMs;
  }

  const sample: SelectionTelemetrySample = {
    elapsedMs: accumulatedMs,
    bodyId: id,
    xM,
    yM,
    vxMs,
    vyMs,
    axMs2,
    ayMs2,
    rXN: Rx,
    rYN: Ry,
    rMagN: Math.hypot(Rx, Ry),
  };

  storeSet((prev) => {
    const chunk = [...prev.selectionTelemetrySamples, sample];
    if (chunk.length <= TELEMETRY_MAX_SAMPLES) return { selectionTelemetrySamples: chunk };
    return { selectionTelemetrySamples: chunk.slice(-TELEMETRY_MAX_SAMPLES) };
  });
}



export interface SimulationState {
  engine: MatterSimulationEngine | null;
  snapshot: ReturnType<MatterSimulationEngine["snapshot"]>;
  layers: LayerEntity[];
  selectedIds: string[];
  selectionAnchorIndex: number;
  hoveredId: string | null;
  activeTool: SpawnTool;
  isPlaying: boolean;
  speed: SimSpeed;
  /** Physics integrator fidelity (solver + substeps); Max adds fixed 120 Hz + render interpolation. */
  simQuality: SimulationQualityMode;
  /** Fraction toward the next fixed physics step (0–1) — used for Max render interpolation only. */
  physicsRenderAlpha: number;
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
  forceMode: ForceApplicationMode;
  forceFxN: number;
  forceFyN: number;
  sustainedForcesActive: boolean;
  /** Impulse flash for canvas overlay (ms timestamp when it ends). */
  forceFlash: { bodyId: string; fxN: number; fyN: number; untilMs: number } | null;
  /** Time-series sampled during live playback for graphing (primary selection). */
  selectionTelemetrySamples: SelectionTelemetrySample[];
  /** Select-tool transform gizmo mode (toolbar / hotkeys). */
  transformGizmoMode: TransformGizmoMode;

  measureStart: { x: number; y: number } | null;
  measureEnd: { x: number; y: number } | null;
  measureUnit: "m" | "cm";
  setMeasureStart: (start: { x: number; y: number } | null) => void;
  setMeasureEnd: (end: { x: number; y: number } | null) => void;
  setMeasureUnit: (unit: "m" | "cm") => void;

  /** Arrow / text / ruler authoring (persisted scene markups). */
  activeMarkupTool: SceneMarkupKind | null;
  markupDraftPoints: { x: number; y: number }[];
  markupPreviewEnd: { x: number; y: number } | null;
  setMarkupTool: (tool: SceneMarkupKind | null) => void;
  addMarkupDraftPoint: (pt: { x: number; y: number }) => void;
  clearMarkupDraft: () => void;
  setMarkupPreviewEnd: (pt: { x: number; y: number } | null) => void;
  addSceneMarkup: (
    kind: SceneMarkupKind,
    points: { x: number; y: number }[],
    text?: string,
  ) => string | null;
  updateSceneMarkup: (
    id: string,
    patch: Partial<
      Pick<SceneMarkupSnapshot, "points" | "text" | "visible" | "locked" | "displayName" | "measureUnit">
    >,
    opts?: { commit?: boolean },
  ) => void;

  gridSnapEnabled: boolean;
  toggleGridSnap: () => void;

  initEngine: (width: number, height: number, benchId?: string | null) => void;
  resize: (width: number, height: number) => void;
  tick: (dt: number) => void;
  setPlaying: (v: boolean) => void;
  setSpeed: (s: SimSpeed) => void;
  setSimulationQuality: (mode: SimulationQualityMode) => void;
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
  setTransformGizmoMode: (mode: TransformGizmoMode) => void;
  authoringSyncFromEngine: () => void;
  finalizeAuthoringBodyTransforms: (bodyIds: string[]) => void;
  deleteSelected: () => void;
  /** In-memory authoring fragment (⌘/Ctrl+C). Not persisted. */
  authoringClipboard: AuthoringClipboardFragment | null;
  copySelectionToClipboard: () => boolean;
  pasteFromClipboard: () => boolean;
  duplicateSelectedAuthoring: () => boolean;
  renameEntity: (id: string, name: string) => void;
  setEntityVisible: (id: string, visible: boolean) => void;
  setEntityLocked: (id: string, locked: boolean) => void;
  setBodyShowTrajectory: (id: string, show: boolean) => void;
  updateBody: (
    id: string,
    patch: Partial<SimBodySnapshot>,
    opts?: { commit?: boolean; summary?: string },
  ) => void;
  updateSpring: (
    id: string,
    patch: Partial<
      Pick<SpringSnapshot, "stiffness" | "damping" | "length" | "elasticConstantNnPerM">
    >,
    opts?: { commit?: boolean; summary?: string },
  ) => void;
  updateRope: (
    id: string,
    patch: Partial<Pick<RopeSnapshot, "linkStiffness" | "linkDamping">>,
    opts?: { commit?: boolean; summary?: string },
  ) => void;
  getGravityForce: (id: string) => { x: number; y: number };
  getUserSustainedForcesNewtons: () => Map<string, { x: number; y: number }>;
  setForceDraft: (
    patch: Partial<{ forceMode: ForceApplicationMode; forceFxN: number; forceFyN: number }>,
  ) => void;
  applyForceToSelection: () => void;
  clearSustainedForces: () => void;
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
    opts?: { refitCamera?: boolean; resetAuthoringHistory?: boolean },
  ) => void;
  /** Clear engine so the next seed/hydrate runs (room or bench switch; global store survives canvas remount). */
  tearDownForRoomChange: () => void;

  canUndoAuthoring: () => boolean;
  canRedoAuthoring: () => boolean;
  undoAuthoring: () => boolean;
  redoAuthoring: () => boolean;
}

/**
 * Modelled resultant force (ΣF) for one frame plus kinematics — aligns Graphs tab with timeline review when
 * `kinematicTail` comes from {@link buildMotionTimelineSamplesForSelection}.
 */
export function composeModeledTelemetrySample(
  state: SimulationState,
  collisions: CollisionDebugPoint[],
  bodyId: string,
  opts?: {
    kinematicTail?: MotionTimelineGraphPoint | null;
    elapsedMsOverride?: number;
  },
): SelectionTelemetrySample | null {
  const snapshot = state.snapshot;
  const body = snapshot.bodies.find((b) => b.id === bodyId);
  if (!body || body.isStatic || body.entityKind === "ropeSegment" || body.visible === false) {
    return null;
  }

  const id = bodyId;
  const g = state.getGravityForce(id);
  const gxN = approximateNewtonSiFromMatterAppliedForceComponent(g.x, body.mass);
  const gyN = approximateNewtonSiFromMatterAppliedForceComponent(g.y, body.mass);
  const apl = state.getUserSustainedForcesNewtons().get(id);
  const apXN = apl?.x ?? 0;
  const apYN = apl?.y ?? 0;

  const spr = sumSpringElasticForcesNnOnBody(snapshot, id, (bid) => state.getGravityForce(bid));
  const cf = estimateContactFrictionNn(
    snapshot,
    id,
    collisions,
    gxN + apXN,
    gyN + apYN,
    body.velocityX,
    body.velocityY,
  );
  const fnx = cf?.fnFx ?? 0;
  const fny = cf?.fnFy ?? 0;
  const ffx = cf?.ffFx ?? 0;
  const ffy = cf?.ffFy ?? 0;

  const Rx = gxN + apXN + spr.fx + fnx + ffx;
  const Ry = gyN + apYN + spr.fy + fny + ffy;

  const kin = opts?.kinematicTail ?? undefined;
  const vxMs = kin ? kin.vxMs : pxPerSecToMPerSec(body.velocityX);
  const vyMs = kin ? kin.vyMs : pxPerSecToMPerSec(body.velocityY);
  const xM = kin ? kin.xM : pxToM(body.x);
  const yM = kin ? kin.yM : pxToM(body.y);
  const axMs2 = kin?.axMs2 ?? 0;
  const ayMs2 = kin?.ayMs2 ?? 0;

  return {
    elapsedMs: opts?.elapsedMsOverride ?? state.elapsedMs,
    bodyId: id,
    xM,
    yM,
    vxMs,
    vyMs,
    axMs2,
    ayMs2,
    rXN: Rx,
    rYN: Ry,
    rMagN: Math.hypot(Rx, Ry),
  };
}

function pasteAuthoringFragmentImpl(
  get: () => SimulationState,
  set: (
    partial: Partial<SimulationState> | ((s: SimulationState) => Partial<SimulationState>),
  ) => void,
  fragment: AuthoringClipboardFragment,
  dx: number,
  dy: number,
): boolean {
  const st = get();
  const engine = st.engine;
  if (!engine || !canAuthorStructuralEdits(st)) return false;

  const pasted = remapClipboardForPaste(fragment, dx, dy);

  const { sync } = collaborativeScenePipeline();
  const incoming = pasted.bodies.length + pasted.springs.length + pasted.ropes.length;
  const existing = countSceneObjects(st.snapshot);
  const limit =
    sync && !!useRoomSceneCollaborationStore.getState().roomId
      ? useRoomSceneCollaborationStore.getState().objectLimit
      : Number.POSITIVE_INFINITY;
  if (existing + incoming > limit) return false;

  instantiatePasteOnEngine(engine, pasted);

  const baseline =
    shouldRefreshSetupBaseline(st) ? refreshSetupBaseline(engine, get().snapshot) : null;
  const snap = engSnap(get().snapshot, engine.snapshot());
  logSimAction("Paste / duplicate authoring", "pasteBatch", undefined, snap.tick);

  const ops = pasted.ops;
  if (ops.length === 1) void pushCollabOp(get, ops[0]!);
  else if (ops.length > 1) void pushCollabOp(get, { type: "batch", ops });

  const newSelection = [
    ...pasted.bodies.map((b) => b.id),
    ...pasted.springs.map((s) => s.id),
    ...pasted.ropes.map((r) => r.id),
  ];
  set({
    snapshot: snap,
    layers: buildLayerList(snap),
    selectedIds: newSelection,
    selectionAnchorIndex: newSelection.length > 0 ? 0 : -1,
    springPending: null,
    ropePending: null,
    springPreviewEnd: null,
    ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
  });
  syncTelemetryToPrimarySelection(get().selectedIds, set);
  recordAuthoringHistoryCheckpoint(get);
  return true;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  engine: null,
  snapshot: { bodies: [], springs: [], ropes: [], tick: 0 },
  layers: [],
  selectedIds: [],
  selectionAnchorIndex: -1,
  hoveredId: null,
  activeTool: "select",
  isPlaying: false,
  speed: 1,
  simQuality: "high",
  physicsRenderAlpha: 0,
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
  forceMode: "impulse",
  forceFxN: 0,
  forceFyN: 10,
  sustainedForcesActive: false,
  forceFlash: null,
  selectionTelemetrySamples: [],
  authoringClipboard: null,
  transformGizmoMode: "move",

  measureStart: null,
  measureEnd: null,
  measureUnit: "m",

  activeMarkupTool: null,
  markupDraftPoints: [],
  markupPreviewEnd: null,

  setMeasureStart: (measureStart) => set({ measureStart }),
  setMeasureEnd: (measureEnd) => set({ measureEnd }),
  setMeasureUnit: (measureUnit) => set({ measureUnit }),

  setMarkupTool: (activeMarkupTool) =>
    set({ activeMarkupTool, markupDraftPoints: [], markupPreviewEnd: null }),
  addMarkupDraftPoint: (pt) =>
    set((s) => ({ markupDraftPoints: [...s.markupDraftPoints, pt] })),
  clearMarkupDraft: () => set({ markupDraftPoints: [], markupPreviewEnd: null }),
  setMarkupPreviewEnd: (markupPreviewEnd) => set({ markupPreviewEnd }),

  addSceneMarkup: (kind, points, text) => {
    if (!canAuthorStructuralEdits(get())) return null;
    const st = get();
    const engine = st.engine;
    const id = crypto.randomUUID();
    const markup: SceneMarkupSnapshot = {
      id,
      displayName: nextMarkupName(kind),
      kind,
      points,
      visible: true,
      ...(kind === "text" ? { text: text?.trim() || "Note" } : {}),
      ...(kind === "measure" ? { measureUnit: st.measureUnit } : {}),
    };
    const markups = [...(st.snapshot.markups ?? []), markup];
    const snap = engine
      ? mergeEngineSnapshotWithDocument(st.snapshot, engine.snapshot())
      : { ...st.snapshot };
    snap.markups = markups;

    if (engine && shouldRefreshSetupBaseline(st)) {
      refreshSetupBaseline(engine, { ...snap });
    }

    void pushCollabOp(get, { type: "entity.add.markup", markup: sanitizeMarkupForCollab(markup) });
    set({
      snapshot: snap,
      layers: buildLayerList(snap),
      selectedIds: [id],
      selectionAnchorIndex: 0,
      activeMarkupTool: null,
      markupDraftPoints: [],
      markupPreviewEnd: null,
      ...(engine && shouldRefreshSetupBaseline(st)
        ? {
            historyIndex: -1,
            historyLength: history.length,
            elapsedMs: 0,
          }
        : {}),
    });
    recordAuthoringHistoryCheckpoint(get);
    return id;
  },

  updateSceneMarkup: (id, patch, opts) => {
    const markups = [...(get().snapshot.markups ?? [])];
    const idx = markups.findIndex((m) => m.id === id);
    if (idx < 0) return;
    markups[idx] = { ...markups[idx]!, ...patch };
    const engine = get().engine;
    const snap = engine
      ? engSnap(get().snapshot, engine.snapshot())
      : { ...get().snapshot };
    snap.markups = markups;
    set({ snapshot: snap, layers: buildLayerList(snap) });
    if (opts?.commit !== false && collaborativeScenePipeline().sync && isAtSharedSetupFrame(get())) {
      void pushCollabOp(get, {
        type: "entity.patch.markup",
        id,
        patch: sanitizeMarkupPatchForCollab(patch),
      });
    }
    if (opts?.commit !== false) recordAuthoringHistoryCheckpoint(get);
  },

  gridSnapEnabled: false,
  toggleGridSnap: () => set((s) => ({ gridSnapEnabled: !s.gridSnapEnabled })),

  initEngine: (width, height, benchId) => {
    const engine = new MatterSimulationEngine();
    const layout = benchId ? getTestLayout(benchId) : undefined;
    if (layout) {
      engine.seedScenario(layout.build(FLUX_WORLD.WIDTH, FLUX_WORLD.HEIGHT));
    } else {
      engine.seedDemo();
    }
    clearTimeline();
    const snap = engSnap({ bodies: [], springs: [], ropes: [], markups: [], tick: 0 }, engine.snapshot());
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
      isPlaying: false,
      selectionTelemetrySamples: [],
      authoringClipboard: null,
    });
    syncTelemetryToPrimarySelection(get().selectedIds, set);
    resetAuthoringHistoryFromState(get);
  },

  hydrateFromStoredScene: (width, height, stored, isPlayingOverride) => {
    const normalized = normalizeStoredScene(stored);
    const engine = new MatterSimulationEngine();
    engine.setSimulationQuality(get().simQuality);
    engine.seedScenario(toSimulationSnapshot(normalized));
    engine.setGravity(normalized.gravityEnabled !== false);
    clearTimeline();
    const snap = attachMarkupsToSnapshot(engine.snapshot(), normalized.markups ?? []);
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
      selectionTelemetrySamples: [],
    });
    syncTelemetryToPrimarySelection(get().selectedIds, set);
    resetAuthoringHistoryFromState(get, normalized);
  },

  reconcilePausedEngineWithServerSnapshot: (stored, opts) => {
    clearPendingRemoteSceneApply();
    const { engine, snapshot: prevSnap } = get();
    if (!engine) return;
    const refitCamera = opts?.refitCamera ?? false;
    const normalized = normalizeStoredScene(stored);
    const prevCamera = get().camera;
    engine.seedScenario(toSimulationSnapshot(normalized));
    engine.setGravity(normalized.gravityEnabled !== false);
    clearTimeline();
    const snap = mergeEngineSnapshotWithDocument(
      { ...prevSnap, markups: normalized.markups ?? [] },
      engine.snapshot(),
    );
    history.push(setupKeyframeSnapshot(snap), 0);
    const prevSel = get().selectedIds;
    const valid = new Set<string>();
    for (const b of snap.bodies) valid.add(b.id);
    for (const s of snap.springs) valid.add(s.id);
    for (const r of snap.ropes ?? []) valid.add(r.id);
    for (const m of snap.markups ?? []) valid.add(m.id);
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
      selectionTelemetrySamples: [],
      authoringClipboard: null,
    });
    syncTelemetryToPrimarySelection(get().selectedIds, set);
    if (opts?.resetAuthoringHistory && !skipAuthoringHistoryRecord) {
      resetAuthoringHistoryFromState(get, normalized);
    }
  },

  tearDownForRoomChange: () => {
    clearTimeline();
    authoringUndoStack.reset();
    dragId = null;
    groupDrag = null;
    resetPhysicsFixedAccumulator();
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
      sustainedForcesActive: false,
      selectionTelemetrySamples: [],
      authoringClipboard: null,
      transformGizmoMode: "move",
      physicsRenderAlpha: 0,
    });
    telemetryTrackedPrimary = null;
    resetTelemetryDerivativeState();
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
    const { engine, isPlaying, speed, historyIndex, isScrubbing, forceFlash, simQuality } = get();
    if (forceFlash && performance.now() > forceFlash.untilMs) {
      set({ forceFlash: null });
    }
    if (!engine) return;
    const len = history.length;
    const atLive = isAtLiveEdge(historyIndex, len) && !isScrubbing;

    if (isPlaying && atLive) {
      const preset = getSimulationQualityPreset(simQuality);
      const fixedMs = preset.fixedTimestepMs;

      if (fixedMs && fixedMs > 0) {
        physicsFixedAccumulator += dt * speed;
        let steps = 0;
        while (
          physicsFixedAccumulator >= fixedMs &&
          steps < preset.maxFixedStepsPerFrame
        ) {
          engine.beginFixedPhysicsStep();
          engine.step(fixedMs, 1);
          physicsFixedAccumulator -= fixedMs;
          steps += 1;
        }
        if (steps > 0 && !dragId) {
          recordFrame(engine, steps * fixedMs, speed);
        }
        const alpha =
          fixedMs > 0 ? Math.min(1, Math.max(0, physicsFixedAccumulator / fixedMs)) : 0;
        const snap = engSnap(get().snapshot, engine.snapshot());
        const collisions = engine.getCollisionDebugPoints();
        if (!dragId) {
          finalizePlaybackTelemetrySample(snap, collisions, accumulatedElapsed, get, set);
        }
        set({
          snapshot: snap,
          layers: buildLayerList(snap),
          historyIndex: -1,
          historyLength: history.length,
          elapsedMs: accumulatedElapsed,
          physicsRenderAlpha: alpha,
        });
      } else {
        physicsFixedAccumulator = 0;
        engine.step(dt, speed);
        if (!dragId) recordFrame(engine, dt, speed);
        const snap = engSnap(get().snapshot, engine.snapshot());
        const collisions = engine.getCollisionDebugPoints();
        if (!dragId) {
          finalizePlaybackTelemetrySample(snap, collisions, accumulatedElapsed, get, set);
        }
        set({
          snapshot: snap,
          layers: buildLayerList(snap),
          historyIndex: -1,
          historyLength: history.length,
          elapsedMs: accumulatedElapsed,
          physicsRenderAlpha: 0,
        });
      }
    }
  },

  setPlaying: (isPlaying) => {
    const wasPlaying = get().isPlaying;
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
        engine.clearUserSustainedForces();
        resetPhysicsFixedAccumulator();
      }
    }
    if (isPlaying && engine && historyIndex >= 0) {
      history.truncateTo(historyIndex);
      accumulatedElapsed = elapsedMs;
      set({ historyIndex: -1, historyLength: history.length });
    }
    if (isPlaying && !wasPlaying) {
      resetTelemetryDerivativeState();
      resetPhysicsFixedAccumulator();
    }
    set({ isPlaying, sustainedForcesActive: false, physicsRenderAlpha: isPlaying ? get().physicsRenderAlpha : 0 });
  },

  setSpeed: (speed) => set({ speed }),

  setSimulationQuality: (simQuality) => {
    const { engine } = get();
    engine?.setSimulationQuality(simQuality);
    resetPhysicsFixedAccumulator();
    set({ simQuality, physicsRenderAlpha: 0 });
  },
  setTool: (activeTool) => {
    const state = get();
    const debug =
      activeTool === "force" &&
      (!state.debug.forceVectors || !state.debug.gravityVectors || !state.debug.appliedForces)
        ? {
            ...state.debug,
            forceVectors: true,
            gravityVectors: true,
            appliedForces: true,
          }
        : state.debug;
    set({
      activeTool,
      springPending: null,
      ropePending: null,
      springPreviewEnd: null,
      measureStart: null,
      measureEnd: null,
      activeMarkupTool: null,
      markupDraftPoints: [],
      markupPreviewEnd: null,
      debug,
    });
  },

  setSpringPreviewEnd: (springPreviewEnd) => set({ springPreviewEnd }),

  updateSpringPreviewFromPointer: (x, y, ctrlKey, shiftKey) => {
    const { activeTool, springPending, engine } = get();
    if (
      (activeTool !== "spring" && activeTool !== "rigidBar") ||
      !springPending ||
      !engine
    ) {
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
      syncTelemetryToPrimarySelection(get().selectedIds, set);
      return;
    }

    if (opts?.subtract) {
      set({
        selectedIds: selectedIds.filter((x) => x !== id),
        selectionAnchorIndex: idx >= 0 ? idx : selectionAnchorIndex,
      });
      syncTelemetryToPrimarySelection(get().selectedIds, set);
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
      syncTelemetryToPrimarySelection(get().selectedIds, set);
      return;
    }

    set({ selectedIds: [id], selectionAnchorIndex: idx >= 0 ? idx : 0 });
    syncTelemetryToPrimarySelection(get().selectedIds, set);
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
    syncTelemetryToPrimarySelection(get().selectedIds, set);
  },

  selectInMarquee: (rect, mode) => {
    const ids = idsInMarqueeRect(get().snapshot, rect);
    get().selectEntities(ids, mode);
  },

  clearSelection: () => {
    set({ selectedIds: [], selectionAnchorIndex: -1 });
    syncTelemetryToPrimarySelection(get().selectedIds, set);
  },
  setHovered: (hoveredId) => set({ hoveredId }),

  toggleGravity: () => {
    const { engine, gravityEnabled } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    const next = !gravityEnabled;
    engine.setGravity(next);
    set({ gravityEnabled: next });
    void pushCollabOp(get, { type: "scene.gravity", gravityEnabled: next });
    recordAuthoringHistoryCheckpoint(get);
  },

  toggleDebug: (key) =>
    set((s) => ({ debug: { ...s.debug, [key]: !s.debug[key] } })),

  setDebug: (key, value) =>
    set((s) => ({ debug: { ...s.debug, [key]: value } })),

  spawnAt: (x, y, opts) => {
    const snapEnabled = !(opts?.ctrlKey ?? false);
    const shiftKey = opts?.shiftKey ?? false;
    const { engine, activeTool, springPending, gridSnapEnabled } = get();
    if (!engine) return;

    if (gridSnapEnabled) {
      x = Math.round(x / 10) * 10;
      y = Math.round(y / 10) * 10;
    }

    const { sync } = collaborativeScenePipeline();
    if (sync && !isAtSharedSetupFrame(get())) return;

    const atCap =
      sync &&
      countSceneObjects(get().snapshot) >= useRoomSceneCollaborationStore.getState().objectLimit;

    if (atCap && (activeTool === "circle" || activeTool === "rectangle")) return;

    if (activeTool === "circle") {
      const id = engine.spawnCircle(x, y);
      const baseline =
        shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
      const snap = engSnap(get().snapshot, engine.snapshot());
      logSimAction("Spawned circle", "spawn", id, snap.tick);
      const body = snap.bodies.find((b) => b.id === id);
      if (body) void pushCollabOp(get, { type: "entity.add.body", body });
      set({
        selectedIds: [id],
        snapshot: snap,
        layers: buildLayerList(snap),
        ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
      });
      syncTelemetryToPrimarySelection(get().selectedIds, set);
      recordAuthoringHistoryCheckpoint(get);
      return;
    }
    if (activeTool === "rectangle") {
      const id = engine.spawnRectangle(x, y);
      const baseline =
        shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
      const snap = engSnap(get().snapshot, engine.snapshot());
      logSimAction("Spawned box", "spawn", id, snap.tick);
      const body = snap.bodies.find((b) => b.id === id);
      if (body) void pushCollabOp(get, { type: "entity.add.body", body });
      set({
        selectedIds: [id],
        snapshot: snap,
        layers: buildLayerList(snap),
        ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
      });
      syncTelemetryToPrimarySelection(get().selectedIds, set);
      recordAuthoringHistoryCheckpoint(get);
      return;
    }
    if (activeTool === "collisionBox") {
      const prevId = get().snapshot.bodies.find((b) => b.entityKind === "collisionBounds")?.id;
      const id = engine.spawnCollisionBounds(x, y);
      const baseline =
        shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
      const snap = engSnap(get().snapshot, engine.snapshot());
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
      syncTelemetryToPrimarySelection(get().selectedIds, set);
      recordAuthoringHistoryCheckpoint(get);
      return;
    }
    if (activeTool === "spring" || activeTool === "rigidBar") {
      const snap = engSnap(get().snapshot, engine.snapshot());
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
        syncTelemetryToPrimarySelection(get().selectedIds, set);
        return;
      }
      if (springPending.bodyId !== hit.id) {
        if (atCap) return;
        const endAttach = resolveAttachPoint(hit, x, y, {
          snap: snapEnabled,
          angleSnap: shiftKey,
          angleSnapOrigin: springPending,
        });
        const connectOpts = {
          pointA: { x: springPending.localX, y: springPending.localY },
          pointB: { x: endAttach.localX, y: endAttach.localY },
        };
        const sid =
          activeTool === "rigidBar"
            ? engine.connectRigidBar(springPending.bodyId, hit.id, connectOpts)
            : engine.connectSpring(springPending.bodyId, hit.id, connectOpts);
        const baseline =
          shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
        const next = engSnap(get().snapshot, engine.snapshot());
        logSimAction(
          activeTool === "rigidBar" ? "Connected rigid bar" : "Connected spring",
          "spring",
          sid ?? undefined,
          next.tick,
        );
        if (sid) {
          const sp = next.springs.find((s) => s.id === sid);
          if (sp) void pushCollabOp(get, { type: "entity.add.spring", spring: sp });
        }
        set({
          springPending: null,
          springPreviewEnd: null,
          activeTool: "select",
          snapshot: next,
          layers: buildLayerList(next),
          ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
          ...(sid ? { selectedIds: [sid] } : {}),
        });
        syncTelemetryToPrimarySelection(get().selectedIds, set);
        recordAuthoringHistoryCheckpoint(get);
      }
      return;
    }
    if (activeTool === "rope") {
      const { ropePending } = get();
      const snap = engSnap(get().snapshot, engine.snapshot());
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
        syncTelemetryToPrimarySelection(get().selectedIds, set);
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
          shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
        const next = engSnap(get().snapshot, engine.snapshot());
        logSimAction("Connected rope", "rope", rid ?? undefined, next.tick);
        if (rid) {
          const rope = (next.ropes ?? []).find((r) => r.id === rid);
          if (rope) {
            void pushCollabOp(get, {
              type: "entity.add.rope",
              rope: sanitizeRopeForCollab(rope),
            });
          }
        }
        set({
          ropePending: null,
          springPreviewEnd: null,
          activeTool: "select",
          snapshot: next,
          layers: buildLayerList(next),
          ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
          ...(rid ? { selectedIds: [rid] } : {}),
        });
        syncTelemetryToPrimarySelection(get().selectedIds, set);
        recordAuthoringHistoryCheckpoint(get);
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

    const markup = (snapshot.markups ?? []).find((m) => m.id === id);
    if (markup) {
      if (markup.locked) return;
      const dragTargets = selectedIds.filter((sid) =>
        (snapshot.markups ?? []).some((m) => m.id === sid && !m.locked),
      );
      const group =
        dragTargets.length > 1 && dragTargets.includes(id) ? dragTargets : [id];
      const origins = new Map<string, { x: number; y: number }[]>();
      for (const mid of group) {
        const m = (snapshot.markups ?? []).find((x) => x.id === mid);
        if (m) origins.set(mid, m.points.map((p) => ({ x: p.x, y: p.y })));
      }
      markupDrag = { anchorId: id, pointerStartX: pointerX, pointerStartY: pointerY, origins };
      dragId = id;
      return;
    }

    const body = snapshot.bodies.find((b) => b.id === id);
    if (!body || body.locked || !isDraggableBody(body)) return;

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
      const snap = engSnap(get().snapshot, engine.snapshot());
      set({ snapshot: snap, layers: buildLayerList(snap) });
      return;
    }

    groupDrag = null;
    engine.beginDrag(id, pointerX, pointerY);
    const snap = engSnap(get().snapshot, engine.snapshot());
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  dragTo: (id, pointerX, pointerY) => {
    const { engine, gridSnapEnabled, snapshot: prevSnap } = get();
    if (!engine || dragId !== id) return;

    let px = pointerX;
    let py = pointerY;
    if (gridSnapEnabled) {
      px = Math.round(px / 10) * 10;
      py = Math.round(py / 10) * 10;
    }

    if (markupDrag && markupDrag.anchorId === id) {
      const dx = px - markupDrag.pointerStartX;
      const dy = py - markupDrag.pointerStartY;
      const markups = [...(prevSnap.markups ?? [])];
      for (const [mid, orig] of markupDrag.origins) {
        const idx = markups.findIndex((m) => m.id === mid);
        if (idx < 0) continue;
        markups[idx] = {
          ...markups[idx]!,
          points: orig.map((p) => ({
            x: gridSnapEnabled ? Math.round((p.x + dx) / 10) * 10 : p.x + dx,
            y: gridSnapEnabled ? Math.round((p.y + dy) / 10) * 10 : p.y + dy,
          })),
        };
      }
      const snap = engSnap(prevSnap, engine.snapshot());
      snap.markups = markups;
      set({ snapshot: snap, layers: buildLayerList(snap) });
      return;
    }

    if (groupDrag) {
      const dx = px - groupDrag.pointerStartX;
      const dy = py - groupDrag.pointerStartY;
      for (const [bid, origin] of groupDrag.origins) {
        let nx = origin.x + dx;
        let ny = origin.y + dy;
        if (gridSnapEnabled) {
          nx = Math.round(nx / 10) * 10;
          ny = Math.round(ny / 10) * 10;
        }
        engine.setBodyPosition(bid, nx, ny, { zeroVelocity: true });
      }
    } else {
      engine.dragTo(id, px, py);
    }
    syncSetupRopes(engine, get());
    const snap = engSnap(get().snapshot, engine.snapshot());
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  setTransformGizmoMode: (mode) =>
    set({ transformGizmoMode: mode }),

  authoringSyncFromEngine: () => {
    const { engine } = get();
    if (!engine) return;
    syncSetupRopes(engine, get());
    const snap = engSnap(get().snapshot, engine.snapshot());
    set({ snapshot: snap, layers: buildLayerList(snap) });
  },

  finalizeAuthoringBodyTransforms: (bodyIds) => {
    const { engine } = get();
    if (!engine || bodyIds.length === 0) return;
    let baselineTruncated = false;
    if (shouldRefreshSetupBaseline(get())) {
      baselineTruncated = refreshSetupBaseline(engine, get().snapshot).truncated;
    } else {
      syncSetupRopes(engine, get());
    }
    const snapAfter = engSnap(get().snapshot, engine.snapshot());
    const uniq = [...new Set(bodyIds)];

    if (collaborativeScenePipeline().sync && isAtSharedSetupFrame(get())) {
      const patchOps: SceneOp[] = [];
      for (const bid of uniq) {
        const b = snapAfter.bodies.find((x) => x.id === bid);
        if (b && b.entityKind !== "wall" && b.entityKind !== "floor") {
          patchOps.push({
            type: "entity.patch.body",
            id: bid,
            patch: {
              x: b.x,
              y: b.y,
              angle: b.angle,
              width: b.width,
              height: b.height,
              mass: b.mass,
            },
          });
        }
      }
      if (patchOps.length === 1) void pushCollabOp(get, patchOps[0]!);
      else if (patchOps.length > 1) void pushCollabOp(get, { type: "batch", ops: patchOps });
    }

    logSimAction("Adjusted selection transform", "transform", uniq.join(","), snapAfter.tick);

    set({
      snapshot: snapAfter,
      layers: buildLayerList(snapAfter),
      ...(baselineTruncated ? historyStateAfterBaselineRefresh(true) : {}),
    });
    syncTelemetryToPrimarySelection(get().selectedIds, set);
    recordAuthoringHistoryCheckpoint(get);
  },

  endDrag: () => {
    const { engine, isPlaying, speed, historyIndex, isScrubbing } = get();
    if (!engine) {
      dragId = null;
      groupDrag = null;
      markupDrag = null;
      return;
    }
    const draggedId = dragId;
    const group = groupDrag;
    const mkDrag = markupDrag;
    const wasDragging = draggedId !== null;
    const wasMarkupDrag = mkDrag !== null;

    if (mkDrag) {
      const patchOps: SceneOp[] = [];
      for (const [mid, _orig] of mkDrag.origins) {
        const m = (get().snapshot.markups ?? []).find((x) => x.id === mid);
        if (m) {
          patchOps.push({
            type: "entity.patch.markup",
            id: mid,
            patch: sanitizeMarkupPatchForCollab({ points: m.points }),
          });
        }
      }
      if (patchOps.length === 1) void pushCollabOp(get, patchOps[0]!);
      else if (patchOps.length > 1) void pushCollabOp(get, { type: "batch", ops: patchOps });
      markupDrag = null;
      dragId = null;
      if (wasMarkupDrag) {
        const snap = engSnap(get().snapshot, engine.snapshot());
        set({ snapshot: snap, layers: buildLayerList(snap) });
        recordAuthoringHistoryCheckpoint(get);
      }
      return;
    }

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
      baselineTruncated = refreshSetupBaseline(engine, get().snapshot).truncated;
    } else {
      syncSetupRopes(engine, get());
    }
    const snapAfter = engSnap(get().snapshot, engine.snapshot());

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
      const snap = engSnap(get().snapshot, engine.snapshot());
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
      recordAuthoringHistoryCheckpoint(get);
    }
  },

  deleteSelected: () => {
    const { engine, selectedIds, snapshot: prevSnap } = get();
    if (!engine || selectedIds.length === 0) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;

    const markupIds = new Set(
      selectedIds.filter((id) => (prevSnap.markups ?? []).some((m) => m.id === id)),
    );
    const physicsIds = selectedIds.filter((id) => !markupIds.has(id));

    for (const id of physicsIds) {
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

    const markupsAfter = (prevSnap.markups ?? []).filter((m) => !markupIds.has(m.id));
    const baseline =
      shouldRefreshSetupBaseline(get())
        ? refreshSetupBaseline(engine, { ...prevSnap, markups: markupsAfter })
        : null;
    const snap = engSnap(prevSnap, engine.snapshot());
    snap.markups = markupsAfter;
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
    syncTelemetryToPrimarySelection(get().selectedIds, set);
    recordAuthoringHistoryCheckpoint(get);
  },

  copySelectionToClipboard: () => {
    const st = get();
    if (!canAuthorStructuralEdits(st)) return false;
    const f = extractAuthoringClipboard(st.snapshot, st.selectedIds);
    set({ authoringClipboard: f ?? null });
    return f != null;
  },

  pasteFromClipboard: () => {
    const st = get();
    if (!canAuthorStructuralEdits(st)) return false;
    const frag = st.authoringClipboard;
    if (!frag) return false;
    return pasteAuthoringFragmentImpl(get, set, frag, PASTE_OFFSET_PX, 0);
  },

  duplicateSelectedAuthoring: () => {
    const st = get();
    if (!canAuthorStructuralEdits(st)) return false;
    const frag = extractAuthoringClipboard(st.snapshot, st.selectedIds);
    if (!frag) return false;
    return pasteAuthoringFragmentImpl(
      get,
      set,
      frag,
      DUPLICATE_CLUSTER_OFFSET_PX,
      DUPLICATE_CLUSTER_OFFSET_PX,
    );
  },

  renameEntity: (id, name) => {
    const { engine, snapshot: prevSnap } = get();
    if (!name.trim()) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    const trimmed = name.trim();
    const markup = (prevSnap.markups ?? []).find((m) => m.id === id);
    if (markup) {
      get().updateSceneMarkup(id, { displayName: trimmed });
      logSimAction(`Renamed to ${trimmed}`, "rename", id, prevSnap.tick);
      return;
    }
    if (!engine) return;
    engine.renameEntity(id, trimmed);
    const snap = engSnap(prevSnap, engine.snapshot());
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
    recordAuthoringHistoryCheckpoint(get);
  },

  setEntityVisible: (id, visible) => {
    const { engine, snapshot: prevSnap } = get();
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    const markup = (prevSnap.markups ?? []).find((m) => m.id === id);
    if (markup) {
      get().updateSceneMarkup(id, { visible });
      logSimAction(visible ? "Showed layer" : "Hidden layer", "visibility", id, prevSnap.tick);
      return;
    }
    if (!engine) return;
    engine.setEntityVisible(id, visible);
    const snap = engSnap(prevSnap, engine.snapshot());
    logSimAction(visible ? "Showed layer" : "Hidden layer", "visibility", id, snap.tick);
    if (snap.springs.some((s) => s.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.spring", id, patch: { visible } });
    } else if ((snap.ropes ?? []).some((r) => r.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.rope", id, patch: { visible } });
    } else {
      void pushCollabOp(get, { type: "entity.patch.body", id, patch: { visible } });
    }
    set({ snapshot: snap, layers: buildLayerList(snap) });
    recordAuthoringHistoryCheckpoint(get);
  },

  setEntityLocked: (id, locked) => {
    const { engine, snapshot: prevSnap } = get();
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    const markup = (prevSnap.markups ?? []).find((m) => m.id === id);
    if (markup) {
      get().updateSceneMarkup(id, { locked });
      logSimAction(locked ? "Locked layer" : "Unlocked layer", "lock", id, prevSnap.tick);
      return;
    }
    if (!engine) return;
    engine.setEntityLocked(id, locked);
    const snap = engSnap(prevSnap, engine.snapshot());
    logSimAction(locked ? "Locked layer" : "Unlocked layer", "lock", id, snap.tick);
    if (snap.springs.some((s) => s.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.spring", id, patch: { locked } });
    } else if ((snap.ropes ?? []).some((r) => r.id === id)) {
      void pushCollabOp(get, { type: "entity.patch.rope", id, patch: { locked } });
    } else {
      void pushCollabOp(get, { type: "entity.patch.body", id, patch: { locked } });
    }
    set({ snapshot: snap, layers: buildLayerList(snap) });
    recordAuthoringHistoryCheckpoint(get);
  },

  setBodyShowTrajectory: (id, show) => {
    const { engine } = get();
    if (!engine) return;
    engine.setBodyShowTrajectory(id, show);
    const baseline =
      shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
    const snap = engSnap(get().snapshot, engine.snapshot());
    if (collaborativeScenePipeline().sync && isAtSharedSetupFrame(get())) {
      void pushCollabOp(get, { type: "entity.patch.body", id, patch: { showTrajectory: show } });
    }
    set({
      snapshot: snap,
      layers: buildLayerList(snap),
      ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
    });
    recordAuthoringHistoryCheckpoint(get);
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
      shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
    syncSetupRopes(engine, get());
    const snap = engSnap(get().snapshot, engine.snapshot());
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
    if (commit) recordAuthoringHistoryCheckpoint(get);
  },

  updateSpring: (id, patch, opts) => {
    const { engine } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;

    const props: {
      stiffness?: number;
      damping?: number;
      length?: number;
      elasticConstantNnPerM?: number;
    } = {};
    if (patch.stiffness !== undefined) props.stiffness = patch.stiffness;
    if (patch.damping !== undefined) props.damping = patch.damping;
    if (patch.length !== undefined) props.length = patch.length;
    if (patch.elasticConstantNnPerM !== undefined) {
      props.elasticConstantNnPerM = patch.elasticConstantNnPerM;
    }
    if (Object.keys(props).length === 0) return;

    engine.updateSpringProps(id, props);
    const baseline =
      shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
    const snap = engSnap(get().snapshot, engine.snapshot());
    const commit = opts?.commit !== false;
    if (commit) {
      logSimAction(opts?.summary ?? "Updated spring", "setComponent", id, snap.tick);
      const p = sanitizeSpringPatchForCollab(patch);
      if (Object.keys(p).length > 0) {
        if (collaborativeScenePipeline().sync) {
          const collabState = useRoomSceneCollaborationStore.getState();
          if (collabState.lastServerSnapshot) {
            useRoomSceneCollaborationStore.setState({
              lastServerSnapshot: applySceneOpToStoredSnapshot(collabState.lastServerSnapshot, {
                type: "entity.patch.spring",
                id,
                patch: p,
              }),
            });
          }
        }
        void pushCollabOp(get, { type: "entity.patch.spring", id, patch: p });
      }
    }
    set((prev) => ({
      snapshot: snap,
      layers: buildLayerList(snap),
      camera: prev.camera,
      ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
    }));
    if (commit) recordAuthoringHistoryCheckpoint(get);
  },

  updateRope: (id, patch, opts) => {
    const { engine } = get();
    if (!engine) return;
    if (collaborativeScenePipeline().sync && !isAtSharedSetupFrame(get())) return;
    engine.updateRopeProps(id, {
      linkStiffness: patch.linkStiffness,
      linkDamping: patch.linkDamping,
    });
    const snap = engSnap(get().snapshot, engine.snapshot());
    const commit = opts?.commit !== false;
    if (commit) {
      logSimAction(opts?.summary ?? "Updated rope", "setComponent", id, snap.tick);
      const p = sanitizeRopePatchForCollab(patch);
      if (Object.keys(p).length > 0) {
        void pushCollabOp(get, { type: "entity.patch.rope", id, patch: p });
      }
    }
    set({ snapshot: snap, layers: buildLayerList(snap) });
    if (commit) recordAuthoringHistoryCheckpoint(get);
  },

  getGravityForce: (id) => {
    const { engine } = get();
    return engine?.getGravityForceOnBody(id) ?? { x: 0, y: 0 };
  },

  getUserSustainedForcesNewtons: () => {
    const { engine } = get();
    return engine?.getUserSustainedForcesNewtons() ?? new Map();
  },

  setForceDraft: (patch) =>
    set((s) => ({
      forceMode: patch.forceMode ?? s.forceMode,
      forceFxN: patch.forceFxN ?? s.forceFxN,
      forceFyN: patch.forceFyN ?? s.forceFyN,
    })),

  applyForceToSelection: () => {
    const { engine, selectedIds, forceFxN, forceFyN, forceMode, isPlaying } = get();
    const id = selectedIds[0];
    if (!engine || !id) return;
    const body = get().snapshot.bodies.find((b) => b.id === id);
    if (!body || body.isStatic || body.entityKind === "wall" || body.entityKind === "floor") {
      return;
    }

    if (forceMode === "impulse") {
      if (!engine.applyImpulseNewtons(id, forceFxN, forceFyN)) return;
      set({
        forceFlash: {
          bodyId: id,
          fxN: forceFxN,
          fyN: forceFyN,
          untilMs: performance.now() + 900,
        },
      });
      const updated = engine.snapshot().bodies.find((b) => b.id === id);
      if (!updated) return;

      if (isAtSharedSetupFrame(get()) && collaborativeScenePipeline().sync) {
        get().updateBody(
          id,
          { velocityX: updated.velocityX, velocityY: updated.velocityY },
          { commit: true, summary: `Applied impulse to ${body.displayName}` },
        );
        return;
      }

      const baseline =
        shouldRefreshSetupBaseline(get()) ? refreshSetupBaseline(engine, get().snapshot) : null;
      const snap = engSnap(get().snapshot, engine.snapshot());
      logSimAction(`Applied impulse to ${body.displayName}`, "setComponent", id, snap.tick);
      set({
        snapshot: snap,
        layers: buildLayerList(snap),
        ...(baseline ? historyStateAfterBaselineRefresh(baseline.truncated) : {}),
      });
      return;
    }

    if (!engine.setSustainedForceNewtons(id, forceFxN, forceFyN)) return;
    const active = engine.getUserSustainedForcesNewtons().size > 0;
    set({ sustainedForcesActive: active });
    if (!isPlaying) {
      get().setPlaying(true);
    }
  },

  clearSustainedForces: () => {
    const { engine } = get();
    engine?.clearUserSustainedForces();
    set({ sustainedForcesActive: false });
  },

  getCollisions: () => {
    const { engine } = get();
    return engine?.getCollisionDebugPoints() ?? [];
  },

  scrubTo: (index) => {
    const { engine, historyLength } = get();
    if (!engine || historyLength === 0) return;
    const clamped = Math.max(0, Math.min(index, historyLength - 1));
    const raw = applyHistoryIndex(engine, clamped);
    const snap = attachMarkupsToSnapshot(raw, get().snapshot.markups);
    const atSetup = isAtSharedSetupFrame({ historyIndex: clamped, historyLength });
    set((state) => ({
      historyIndex: clamped,
      snapshot: snap,
      layers: buildLayerList(snap),
      elapsedMs: history.getElapsedMs(clamped),
      isPlaying: false,
      sustainedForcesActive: false,
      springPending: atSetup ? state.springPending : null,
      ropePending: atSetup ? state.ropePending : null,
    }));
    if (clamped === 0) {
      flushDeferredRemoteSceneApply();
    }
  },

  setScrubbing: (isScrubbing) => set({ isScrubbing }),

  stepForward: () => {
    const { engine, historyIndex, historyLength, speed, simQuality } = get();
    if (!engine || historyLength === 0) return;
    const atLive =
      isAtLiveEdge(historyIndex, historyLength) ||
      historyIndex >= historyLength - 1;
    if (atLive) {
      const preset = getSimulationQualityPreset(simQuality);
      const stepMs = preset.fixedTimestepMs ?? 16.667;
      if (preset.fixedTimestepMs) {
        engine.beginFixedPhysicsStep();
      }
      engine.stepOnce(stepMs, preset.fixedTimestepMs ? 1 : speed);
      recordFrame(engine, stepMs, speed);
      const snap = engSnap(get().snapshot, engine.snapshot());
      set({
        snapshot: snap,
        layers: buildLayerList(snap),
        historyIndex: -1,
        historyLength: history.length,
        elapsedMs: accumulatedElapsed,
        isPlaying: false,
        physicsRenderAlpha: 0,
      });
      return;
    }
    const next = Math.min(historyIndex + 1, historyLength - 1);
    const snap = attachMarkupsToSnapshot(applyHistoryIndex(engine, next), get().snapshot.markups);
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
    const snap = attachMarkupsToSnapshot(applyHistoryIndex(engine, prev), get().snapshot.markups);
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

  canUndoAuthoring: () => {
    const st = get();
    return !!st.engine && !st.isPlaying && authoringUndoStack.canUndo();
  },

  canRedoAuthoring: () => {
    const st = get();
    return !!st.engine && !st.isPlaying && authoringUndoStack.canRedo();
  },

  undoAuthoring: () => {
    const st0 = get();
    authoringUndoDebugLog(
      "undo",
      `attempt playing=${st0.isPlaying} stack=${JSON.stringify(authoringUndoStack.getDebugCounts())}`,
    );
    if (st0.isPlaying) get().setPlaying(false);
    if (!isAtSharedSetupFrame(get())) get().scrubTo(0);
    const block = describeAuthoringUndoBlock(get());
    if (block) {
      authoringUndoDebugLog("undo", `BLOCKED: ${block}`);
      return false;
    }
    const stored = authoringUndoStack.undo();
    if (!stored) {
      authoringUndoDebugLog("undo", "BLOCKED: undo() returned null");
      return false;
    }
    skipAuthoringHistoryRecord = true;
    try {
      const normalized = normalizeStoredScene(stored);
      get().reconcilePausedEngineWithServerSnapshot(normalized, { refitCamera: false });
      void pushCollabOp(get, { type: "scene.replace", snapshot: normalized });
      logSimAction("Undo", "undo", undefined, get().snapshot.tick);
      authoringUndoDebugLog("undo", `OK · index=${authoringUndoStack.getDebugCounts().index}`);
      return true;
    } finally {
      skipAuthoringHistoryRecord = false;
    }
  },

  redoAuthoring: () => {
    const st0 = get();
    authoringUndoDebugLog(
      "redo",
      `attempt playing=${st0.isPlaying} stack=${JSON.stringify(authoringUndoStack.getDebugCounts())}`,
    );
    if (st0.isPlaying) get().setPlaying(false);
    if (!isAtSharedSetupFrame(get())) get().scrubTo(0);
    const st = get();
    if (!st.engine || st.isPlaying) {
      authoringUndoDebugLog("redo", `BLOCKED: engine=${!!st.engine} playing=${st.isPlaying}`);
      return false;
    }
    if (!authoringUndoStack.canRedo()) {
      authoringUndoDebugLog("redo", "BLOCKED: stack_canRedo=false");
      return false;
    }
    const stored = authoringUndoStack.redo();
    if (!stored) {
      authoringUndoDebugLog("redo", "BLOCKED: redo() returned null");
      return false;
    }
    skipAuthoringHistoryRecord = true;
    try {
      const normalized = normalizeStoredScene(stored);
      get().reconcilePausedEngineWithServerSnapshot(normalized, { refitCamera: false });
      void pushCollabOp(get, { type: "scene.replace", snapshot: normalized });
      logSimAction("Redo", "redo", undefined, get().snapshot.tick);
      authoringUndoDebugLog("redo", `OK · index=${authoringUndoStack.getDebugCounts().index}`);
      return true;
    } finally {
      skipAuthoringHistoryRecord = false;
    }
  },
}));

export { SPEEDS };
export type { SceneCamera } from "@/lib/physics/worldSpace";

/** Primary selected entity id (first in selection). */
export function usePrimarySelection(): string | null {
  return useSimulationStore((s) => s.selectedIds[0] ?? null);
}
