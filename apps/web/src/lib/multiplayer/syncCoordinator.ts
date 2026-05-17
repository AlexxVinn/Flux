"use client";

import { pullAndApplyRemoteScene } from "@/lib/collaboration/remoteSceneSync";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { useMultiplayerConnectionStore } from "@/lib/multiplayer/connectionStore";
import { installMultiplayerDevtools, mpLog } from "@/lib/multiplayer/diagnostics";

/** Authoritative snapshot pull interval when the workspace tab is active. */
const PERIODIC_SYNC_MS = 4_000;

let intervalId: number | null = null;
let boundRoomId: string | null = null;
let devtoolsInstalled = false;

async function runTick(roomId: string): Promise<void> {
  if (useRoomSessionStore.getState().membership?.roomId !== roomId) return;
  if (!useCollaborationStore.getState().supabaseConnected) return;

  const prev = useMultiplayerConnectionStore.getState().lastSuccessfulSyncAt;
  const applied = await pullAndApplyRemoteScene({ refitCamera: false });
  if (applied) {
    useMultiplayerConnectionStore.getState().noteSyncSuccess();
    mpLog("debug", "periodic_sync.ok", { roomId });
  } else if (prev !== useMultiplayerConnectionStore.getState().lastSuccessfulSyncAt) {
    /* pull may have partially updated store */
  } else {
    mpLog("debug", "periodic_sync.noop", { roomId });
  }
}

/**
 * Starts server-driven reconciliation loop (Postgres snapshot is source of truth).
 * Idempotent; stops any prior coordinator for another room.
 */
export function startRoomSyncCoordinator(roomId: string): void {
  stopRoomSyncCoordinator();
  boundRoomId = roomId;
  if (!devtoolsInstalled && typeof window !== "undefined") {
    installMultiplayerDevtools();
    devtoolsInstalled = true;
  }
  mpLog("info", "sync_coordinator.start", { roomId });
  void runTick(roomId);
  intervalId = window.setInterval(() => {
    void runTick(roomId);
  }, PERIODIC_SYNC_MS);
}

export function stopRoomSyncCoordinator(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (boundRoomId) {
    mpLog("info", "sync_coordinator.stop", { roomId: boundRoomId });
  }
  boundRoomId = null;
}
