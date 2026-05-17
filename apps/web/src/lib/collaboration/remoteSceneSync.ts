"use client";

import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useSimulationStore } from "@/store/simulationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { mpRecordDesync } from "@/lib/multiplayer/diagnostics";
import { useMultiplayerConnectionStore } from "@/lib/multiplayer/connectionStore";

let appliedRevision = -1;
let appliedRoomId: string | null = null;

export function resetRemoteSceneSyncState(): void {
  appliedRevision = -1;
  appliedRoomId = null;
}

function snapshotSignature(snap: {
  bodies: { id: string; x: number; y: number }[];
  springs: { id: string }[];
  ropes?: { id: string }[];
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
  return `${bodyBits}#${springIds}#${ropeIds}`;
}

/** Call after a local `apply_scene_op` ack so we do not re-seed the engine on our own revision bump. */
export function markLocalSceneRevisionApplied(revision: number, roomId: string): void {
  appliedRoomId = roomId;
  appliedRevision = revision;
}

/**
 * Pull authoritative scene from Postgres and apply to the Matter engine when revision advances.
 */
export async function pullAndApplyRemoteScene(opts?: {
  refitCamera?: boolean;
  force?: boolean;
}): Promise<boolean> {
  const membership = useRoomSessionStore.getState().membership;
  const collab = useRoomSceneCollaborationStore.getState();
  if (!membership?.roomId || collab.roomId !== membership.roomId) return false;

  const prevRevision = collab.sceneRevision;
  const ok = await useRoomSceneCollaborationStore.getState().refreshFromServer();
  if (!ok) return false;

  useMultiplayerConnectionStore.getState().noteSyncSuccess();

  const drift = detectLocalServerRevisionDrift();
  if (drift?.drift) {
    mpRecordDesync("snapshot_hash_mismatch", drift);
  }

  return applyCollaborativeSceneFromStore(opts?.refitCamera ?? false, opts?.force ?? false, prevRevision);
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
  const engineSig = snapshotSignature(sim.snapshot);
  const serverSig = snapshotSignature(collab.lastServerSnapshot);
  return {
    drift: revisionUnchanged && engineSig !== serverSig,
    localApplied: appliedRevision,
    server,
  };
}

export function applyCollaborativeSceneFromStore(
  refitCamera = false,
  force = false,
  minRevision?: number,
): boolean {
  const membership = useRoomSessionStore.getState().membership;
  const collab = useRoomSceneCollaborationStore.getState();
  const roomId = collab.roomId;

  if (!roomId || !membership?.roomId || membership.roomId !== roomId) return false;

  const snap = collab.lastServerSnapshot;
  if (!snap) return false;

  const revision = collab.sceneRevision;
  const sim = useSimulationStore.getState();
  if (!sim.engine) return false;

  const engineSig = snapshotSignature(sim.snapshot);
  const serverSig = snapshotSignature(snap);
  const revisionUnchanged =
    !force && appliedRoomId === roomId && appliedRevision === revision;
  if (revisionUnchanged && engineSig === serverSig) {
    return true;
  }
  if (minRevision !== undefined && revision <= minRevision && !force) {
    return false;
  }

  sim.reconcilePausedEngineWithServerSnapshot(snap, { refitCamera });
  appliedRoomId = roomId;
  appliedRevision = revision;
  return true;
}
