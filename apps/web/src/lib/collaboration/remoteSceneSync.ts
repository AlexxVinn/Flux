"use client";

import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useSimulationStore } from "@/store/simulationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { mpRecordDesync } from "@/lib/multiplayer/diagnostics";
import { useMultiplayerConnectionStore } from "@/lib/multiplayer/connectionStore";
import { localEngineMatchesStoredAuthoring } from "@/lib/scene/storedScene";

let appliedRevision = -1;
let appliedRoomId: string | null = null;
let pendingEngineApply = false;
let pendingRemoteSceneApply = false;

export function resetRemoteSceneSyncState(): void {
  appliedRevision = -1;
  appliedRoomId = null;
  pendingEngineApply = false;
  pendingRemoteSceneApply = false;
}

export function clearPendingRemoteSceneApply(): void {
  pendingRemoteSceneApply = false;
}

/** Remote setup snapshots apply only at frame 0; playback and timeline review stay local. */
function shouldDeferRemoteSceneApply(): boolean {
  const sim = useSimulationStore.getState();
  if (sim.isPlaying) return true;
  const { historyIndex, historyLength } = sim;
  if (historyLength === 0) return false;
  if (historyIndex === 0) return false;
  if (historyIndex < 0 && historyLength === 1) return false;
  return true;
}

/** Apply a deferred server snapshot after the user returns to shared setup (Live / frame 0). */
export function flushDeferredRemoteSceneApply(): boolean {
  if (!pendingRemoteSceneApply) return false;
  if (shouldDeferRemoteSceneApply()) return false;
  pendingRemoteSceneApply = false;
  return applyCollaborativeSceneFromStore(false, false);
}

export function snapshotSignature(snap: {
  bodies: { id: string; x: number; y: number }[];
  springs: { id: string }[];
  ropes?: { id: string }[];
  markups?: { id: string }[];
}): string {
  const bodyBits = snap.bodies
    .map((b) => `${b.id}:${Math.round(b.x)}:${Math.round(b.y)}`)
    .sort()
    .join("|");
  const springIds = snap.springs
    .map((s) => s.id)
    .sort()
    .join(",");
  const ropeIds = (snap.ropes ?? [])
    .map((r) => r.id)
    .sort()
    .join(",");
  const markupIds = (snap.markups ?? [])
    .map((m) => m.id)
    .sort()
    .join(",");
  return `${bodyBits}#${springIds}#${ropeIds}#${markupIds}`;
}

function engineNeedsServerSnapshot(force: boolean): boolean {
  if (force) return true;
  const collab = useRoomSceneCollaborationStore.getState();
  const sim = useSimulationStore.getState();
  if (!collab.lastServerSnapshot || !sim.engine) return true;
  const drift = detectLocalServerRevisionDrift();
  if (drift?.drift) return true;
  return !localEngineMatchesStoredAuthoring(
    sim.snapshot,
    sim.gravityEnabled,
    collab.lastServerSnapshot,
  );
}

/** Call after a local `apply_scene_op` ack so we do not re-seed the engine on our own revision bump. */
export function markLocalSceneRevisionApplied(revision: number, roomId: string): void {
  appliedRoomId = roomId;
  appliedRevision = revision;
}

/**
 * Call once the Matter engine exists (PhysicsCanvas mount) to flush a deferred server snapshot.
 */
export function onSimulationEngineReady(): void {
  pendingEngineApply = false;
  void reconcileEngineWithServer({ refitCamera: false, force: false });
}

/**
 * Pull authoritative scene from Postgres and apply to the Matter engine.
 */
export async function pullAndApplyRemoteScene(opts?: {
  refitCamera?: boolean;
  force?: boolean;
}): Promise<boolean> {
  const force = opts?.force ?? false;
  const membership = useRoomSessionStore.getState().membership;
  const collab = useRoomSceneCollaborationStore.getState();
  if (!membership?.roomId || collab.roomId !== membership.roomId) return false;

  const mp = useMultiplayerConnectionStore.getState();
  const realtimeHealthy = mp.supabaseRealtimePhase === "connected";

  // Realtime keeps the collab store fresh; skip the Postgres round-trip when already aligned.
  if (!force && realtimeHealthy) {
    const localOk = await reconcileEngineWithServer({
      refitCamera: opts?.refitCamera ?? false,
      force: false,
    });
    if (localOk) {
      mp.noteSyncSuccess();
      return true;
    }
  }

  const fetched = await useRoomSceneCollaborationStore.getState().refreshFromServer();
  if (!fetched.ok) return false;

  mp.noteSyncSuccess();

  if (fetched.changed) {
    const drift = detectLocalServerRevisionDrift();
    if (drift?.drift) {
      mpRecordDesync("snapshot_hash_mismatch", drift);
    }
  }

  return reconcileEngineWithServer({
    refitCamera: opts?.refitCamera ?? false,
    force,
  });
}

export async function reconcileEngineWithServer(opts?: {
  refitCamera?: boolean;
  force?: boolean;
}): Promise<boolean> {
  const force = opts?.force ?? false;
  if (!force && shouldDeferRemoteSceneApply()) {
    if (engineNeedsServerSnapshot(false)) {
      pendingRemoteSceneApply = true;
    }
    return true;
  }

  const needsApply = engineNeedsServerSnapshot(force);
  if (!needsApply) {
    pendingRemoteSceneApply = false;
    return true;
  }

  const sim = useSimulationStore.getState();
  if (!sim.engine) {
    pendingEngineApply = true;
    return false;
  }

  return applyCollaborativeSceneFromStore(opts?.refitCamera ?? false, force);
}

export function getAppliedSceneRevision(): { roomId: string | null; revision: number } {
  return { roomId: appliedRoomId, revision: appliedRevision };
}

export function detectLocalServerRevisionDrift(): {
  drift: boolean;
  localApplied: number;
  server: number;
} | null {
  const collab = useRoomSceneCollaborationStore.getState();
  const sim = useSimulationStore.getState();
  if (!collab.roomId || !sim.engine || !collab.lastServerSnapshot) return null;
  const server = collab.sceneRevision;
  const revisionUnchanged = appliedRoomId === collab.roomId && appliedRevision === server;
  const aligned = localEngineMatchesStoredAuthoring(
    sim.snapshot,
    sim.gravityEnabled,
    collab.lastServerSnapshot,
  );
  return {
    drift: revisionUnchanged && !aligned,
    localApplied: appliedRevision,
    server,
  };
}

export function applyCollaborativeSceneFromStore(
  refitCamera = false,
  force = false,
): boolean {
  const membership = useRoomSessionStore.getState().membership;
  const collab = useRoomSceneCollaborationStore.getState();
  const roomId = collab.roomId;

  if (!roomId || !membership?.roomId || membership.roomId !== roomId) return false;

  const snap = collab.lastServerSnapshot;
  if (!snap) return false;

  const revision = collab.sceneRevision;
  const sim = useSimulationStore.getState();
  if (!sim.engine) {
    pendingEngineApply = true;
    return false;
  }

  const revisionUnchanged =
    !force && appliedRoomId === roomId && appliedRevision === revision;
  const authoringAligned = localEngineMatchesStoredAuthoring(
    sim.snapshot,
    sim.gravityEnabled,
    snap,
  );
  if (revisionUnchanged && authoringAligned) {
    pendingRemoteSceneApply = false;
    return true;
  }

  if (!force && shouldDeferRemoteSceneApply()) {
    pendingRemoteSceneApply = true;
    return true;
  }

  pendingRemoteSceneApply = false;
  sim.reconcilePausedEngineWithServerSnapshot(snap, {
    refitCamera,
    resetAuthoringHistory: true,
  });
  appliedRoomId = roomId;
  appliedRevision = revision;
  pendingEngineApply = false;
  return true;
}
