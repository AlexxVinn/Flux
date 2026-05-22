"use client";

import { pullAndApplyRemoteScene } from "@/lib/collaboration/remoteSceneSync";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { useMultiplayerConnectionStore } from "@/lib/multiplayer/connectionStore";
import { installMultiplayerDevtools, mpLog } from "@/lib/multiplayer/diagnostics";

/** Safety-net snapshot pull when Realtime is healthy (ops are the primary path). */
const PERIODIC_SYNC_MS = 30_000;
/** More frequent pull while Realtime is down or reconnecting. */
const PERIODIC_SYNC_DEGRADED_MS = 12_000;

let intervalId: number | null = null;
let boundRoomId: string | null = null;
let devtoolsInstalled = false;

async function runTick(roomId: string): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  if (useRoomSessionStore.getState().membership?.roomId !== roomId) return;
  if (!useCollaborationStore.getState().supabaseConnected) return;

  const prev = useMultiplayerConnectionStore.getState().lastSuccessfulSyncAt;
  const applied = await pullAndApplyRemoteScene({ refitCamera: false });
  if (applied) {
    mpLog("debug", "periodic_sync.ok", { roomId });
  } else if (prev !== useMultiplayerConnectionStore.getState().lastSuccessfulSyncAt) {
    /* pull may have partially updated store */
  } else {
    mpLog("debug", "periodic_sync.noop", { roomId });
  }
}

function periodicSyncIntervalMs(): number {
  const phase = useMultiplayerConnectionStore.getState().supabaseRealtimePhase;
  return phase === "connected" ? PERIODIC_SYNC_MS : PERIODIC_SYNC_DEGRADED_MS;
}

function scheduleNextTick(roomId: string): void {
  if (intervalId !== null) {
    clearTimeout(intervalId);
  }
  intervalId = window.setTimeout(() => {
    void runTick(roomId).finally(() => {
      if (boundRoomId === roomId) scheduleNextTick(roomId);
    });
  }, periodicSyncIntervalMs());
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
  scheduleNextTick(roomId);
}

export function stopRoomSyncCoordinator(): void {
  if (intervalId !== null) {
    clearTimeout(intervalId);
    intervalId = null;
  }
  if (boundRoomId) {
    mpLog("info", "sync_coordinator.stop", { roomId: boundRoomId });
  }
  boundRoomId = null;
}
