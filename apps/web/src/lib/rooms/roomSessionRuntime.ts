import type { RoomMembership } from "@flux/shared";
import { applyCollaborativeSceneFromStore } from "@/lib/collaboration/remoteSceneSync";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { useSimulationStore } from "@/store/simulationStore";
import { setCachedRoomId } from "@/lib/supabase/roomRepository";
import { clearPendingRoomJoin } from "@/lib/physics/testLayouts";
import { resetRemoteSceneSyncState } from "@/lib/collaboration/remoteSceneSync";
import { commitRoomMembership, membershipMatchesRoute } from "@/lib/rooms/session";
import { forceResetRoomMembersSync } from "@/store/roomMembersStore";
import { startRoomSyncCoordinator, stopRoomSyncCoordinator } from "@/lib/multiplayer/syncCoordinator";
import { useMultiplayerConnectionStore } from "@/lib/multiplayer/connectionStore";
import { resetMultiplayerDiagnostics } from "@/lib/multiplayer/diagnostics";

/** Bumped on every leave; async work must verify before applying results. */
let sessionGeneration = 0;
let leaveInFlight: Promise<void> | null = null;

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function isSessionCurrent(generation: number, roomId: string): boolean {
  return (
    generation === sessionGeneration &&
    useRoomSessionStore.getState().membership?.roomId === roomId
  );
}

/**
 * Fully tear down the previous room (collab channels, scene, sim).
 * Safe to call multiple times; concurrent callers share one flight.
 */
export async function leaveRoomSession(): Promise<void> {
  if (leaveInFlight) {
    await leaveInFlight;
    return;
  }

  leaveInFlight = (async () => {
    sessionGeneration += 1;

    clearPendingRoomJoin();
    setCachedRoomId(null);

    useCollaborationStore.getState().disconnect();
    useRoomSceneCollaborationStore.getState().setRoomContext(null);
    useSimulationStore.getState().tearDownForRoomChange();
    resetRemoteSceneSyncState();
    forceResetRoomMembersSync();
    useRoomSessionStore.getState().clear();
    stopRoomSyncCoordinator();
    useMultiplayerConnectionStore.getState().reset();
    resetMultiplayerDiagnostics();

    // Let Supabase Realtime finish removing channels (avoids race with next subscribe).
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 80);
    });
  })();

  try {
    await leaveInFlight;
  } finally {
    leaveInFlight = null;
  }
}

/**
 * Switch to a room: leave previous session if needed, then commit membership.
 * Returns a generation token for guarding async follow-up (collab connect, scene load).
 */
export async function activateRoomSession(
  membership: RoomMembership,
  opts?: { anonymous?: boolean },
): Promise<number> {
  const current = useRoomSessionStore.getState().membership;
  const sameSession =
    current?.roomId === membership.roomId &&
    membershipMatchesRoute(current, membership.module, membership.slug);

  if (!sameSession) {
    await leaveRoomSession();
  }

  sessionGeneration += 1;
  const generation = sessionGeneration;

  commitRoomMembership(membership, opts);
  useRoomSessionStore.getState().setCollabBindingEpoch(generation);
  useRoomSceneCollaborationStore.getState().rebindToMembershipIfStale(membership, generation);

  return generation;
}

/** Collab + authoritative scene snapshot; call after activateRoomSession. */
export async function syncRoomSession(
  roomId: string,
  generation: number,
): Promise<boolean> {
  if (!isSessionCurrent(generation, roomId)) return false;

  await useCollaborationStore.getState().connectToRoom(roomId, generation);
  if (!isSessionCurrent(generation, roomId)) return false;

  const ok = await useRoomSceneCollaborationStore.getState().refreshFromServer();
  if (!ok || !isSessionCurrent(generation, roomId)) return ok;

  applyCollaborativeSceneFromStore(false, true);
  startRoomSyncCoordinator(roomId);
  return true;
}
