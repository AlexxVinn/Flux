import type { RoomMembership } from "@flux/shared";
import { reconcileEngineWithServer } from "@/lib/collaboration/remoteSceneSync";
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

/** Bumped on every leave/abandon; async work must verify before applying results. */
let sessionGeneration = 0;
let abandonInFlight: Promise<void> | null = null;
let enterInFlight: Promise<{ generation: number; synced: boolean }> | null = null;

const REALTIME_SETTLE_MS = 120;

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function isSessionCurrent(generation: number, roomId: string): boolean {
  return (
    generation === sessionGeneration &&
    useRoomSessionStore.getState().membership?.roomId === roomId
  );
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** True only while still inside a live workspace session (e.g. bench switch), not after exit + rejoin. */
function isLiveRoomSession(membership: RoomMembership): boolean {
  const session = useRoomSessionStore.getState();
  if (!membershipMatchesRoute(session.membership, membership.module, membership.slug)) {
    return false;
  }
  if (session.membership?.roomId !== membership.roomId) return false;

  const collab = useCollaborationStore.getState();
  const scene = useRoomSceneCollaborationStore.getState();
  return (
    collab.supabaseConnected &&
    collab.roomDbId === membership.roomId &&
    scene.roomId === membership.roomId &&
    scene.collabBindKey !== null
  );
}

/** Tear down collab channels, scene sync, and sim — keep membership. */
async function tearDownRoomRuntime(): Promise<void> {
  useCollaborationStore.getState().disconnect();
  useRoomSceneCollaborationStore.getState().setRoomContext(null);
  useSimulationStore.getState().tearDownForRoomChange();
  resetRemoteSceneSyncState();
  forceResetRoomMembersSync();
  stopRoomSyncCoordinator();
  useMultiplayerConnectionStore.getState().reset();
  resetMultiplayerDiagnostics();
  await settle(REALTIME_SETTLE_MS);
}

/**
 * Exit to home: tear down runtime and abandon membership unless a newer join intent started.
 */
export async function abandonRoomSession(): Promise<void> {
  if (abandonInFlight) {
    await abandonInFlight;
    return;
  }

  abandonInFlight = (async () => {
    const intentAtAbandon = useRoomSessionStore.getState().joinIntentEpoch;
    sessionGeneration += 1;

    await tearDownRoomRuntime();

    if (useRoomSessionStore.getState().joinIntentEpoch === intentAtAbandon) {
      clearPendingRoomJoin();
      setCachedRoomId(null);
      useRoomSessionStore.getState().clear();
    }
  })();

  try {
    await abandonInFlight;
  } finally {
    abandonInFlight = null;
  }
}

/** @deprecated Use abandonRoomSession — kept for call-site compatibility during migration. */
export const leaveRoomSession = abandonRoomSession;

/**
 * Commit membership, optionally recycle runtime, return a generation token for async guards.
 */
export async function activateRoomSession(
  membership: RoomMembership,
  opts?: { anonymous?: boolean },
): Promise<number> {
  if (abandonInFlight) {
    await abandonInFlight;
  }

  const resumeLive = isLiveRoomSession(membership);

  if (!resumeLive) {
    await tearDownRoomRuntime();
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

  const fetched = await useRoomSceneCollaborationStore.getState().refreshFromServer();
  if (!fetched.ok || !isSessionCurrent(generation, roomId)) return fetched.ok;

  await reconcileEngineWithServer({ force: true, refitCamera: false });
  startRoomSyncCoordinator(roomId);
  return true;
}

/** Serialized resolve → activate → sync for one workspace entry. */
export async function enterRoomSession(
  membership: RoomMembership,
  opts?: { anonymous?: boolean },
): Promise<{ generation: number; synced: boolean }> {
  if (enterInFlight) {
    return enterInFlight;
  }

  const flight = (async (): Promise<{ generation: number; synced: boolean }> => {
    const generation = await activateRoomSession(membership, opts);
    const synced = await syncRoomSession(membership.roomId, generation);
    return { generation, synced };
  })();

  enterInFlight = flight;

  try {
    return await flight;
  } finally {
    enterInFlight = null;
  }
}
