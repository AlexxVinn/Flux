import type { ActionLogEntry, CanvasAnnotation, ChatMessage } from "@flux/shared";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { normalizeStoredScene, toSimulationSnapshot, authoringPhysicsSnapshotsEqual } from "@/lib/scene/storedScene";
import { isSupabaseConfigured } from "./client";
import {
  fetchActionLog,
  fetchAnnotations,
  fetchChatMessages,
  resolveRoomId,
  setCachedRoomId,
  subscribeRoomRealtime,
} from "./roomRepository";
import { getSupabase } from "./client";

let unsubscribe: (() => void) | null = null;
let sceneDebounce: ReturnType<typeof setTimeout> | null = null;

function playbackFromRow(row: Record<string, unknown> | undefined): {
  state: string;
  revision: number;
} | null {
  if (!row) return null;
  const state = row.playback_state;
  const rawRev = row.playback_revision;
  const revision =
    typeof rawRev === "number"
      ? rawRev
      : typeof rawRev === "string" && rawRev !== ""
        ? Number(rawRev)
        : NaN;
  if (typeof state !== "string" || !Number.isFinite(revision)) return null;
  return { state, revision };
}

function sceneRevisionFromRow(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  const r = row.scene_revision;
  if (typeof r === "number" && Number.isFinite(r)) return r;
  if (typeof r === "string" && r !== "") {
    const n = Number(r);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when `rooms` row playback or authoritative scene revision changed. */
function shouldHydrateFromRoomRowRealtime(payload: {
  new: Record<string, unknown>;
  old?: Record<string, unknown>;
}): boolean {
  const collab = useRoomSceneCollaborationStore.getState();
  const nextSceneRev = sceneRevisionFromRow(payload.new);
  const prevSceneRev = sceneRevisionFromRow(payload.old);

  const playbackDiffersFromCollab = (): boolean => {
    const next = playbackFromRow(payload.new);
    if (!next) return false;
    return next.state !== collab.playbackState || next.revision !== collab.playbackRevision;
  };

  /** DB Realtime echo of a commit we already merged via `apply_scene_op` ack — avoid full reseed. */
  if (nextSceneRev !== null && nextSceneRev === collab.sceneRevision) {
    const next = playbackFromRow(payload.new);
    const prev = playbackFromRow(payload.old);
    if (next && prev) {
      return next.state !== prev.state || next.revision !== prev.revision;
    }
    return playbackDiffersFromCollab();
  }

  if (nextSceneRev !== null) {
    if (prevSceneRev !== null && nextSceneRev !== prevSceneRev) return true;
    if (prevSceneRev === null && nextSceneRev !== collab.sceneRevision) return true;
  }

  const next = playbackFromRow(payload.new);
  if (!next) return false;

  const prev = playbackFromRow(payload.old);
  if (prev) {
    return next.state !== prev.state || next.revision !== prev.revision;
  }

  return playbackDiffersFromCollab();
}

function scheduleCollaborativeSceneSync(): void {
  if (sceneDebounce) clearTimeout(sceneDebounce);
  sceneDebounce = setTimeout(() => {
    sceneDebounce = null;
    void (async () => {
      const { useRoomSceneCollaborationStore } = await import("@/store/roomSceneCollaborationStore");
      const { useSimulationStore } = await import("@/store/simulationStore");
      const ok = await useRoomSceneCollaborationStore.getState().refreshFromServer();
      if (!ok) return;
      const collab = useRoomSceneCollaborationStore.getState();
      const snap = collab.lastServerSnapshot;
      if (!snap) return;
      const { canvasSize, engine } = useSimulationStore.getState();
      const sim = useSimulationStore.getState();
      if (engine) {
        const remoteSim = toSimulationSnapshot(normalizeStoredScene(snap));
        if (authoringPhysicsSnapshotsEqual(sim.snapshot, remoteSim)) {
          return;
        }
        sim.reconcilePausedEngineWithServerSnapshot(snap, { refitCamera: false });
      } else {
        sim.hydrateFromStoredScene(canvasSize.width, canvasSize.height, snap, false);
      }
    })();
  }, 120);
}

export async function initSupabaseCollaboration(handlers: {
  setMessages: (m: ChatMessage[]) => void;
  appendMessage: (m: ChatMessage) => void;
  setAnnotations: (a: CanvasAnnotation[]) => void;
  appendAnnotation: (a: CanvasAnnotation) => void;
  setActionLog: (a: ActionLogEntry[]) => void;
  appendAction: (a: ActionLogEntry) => void;
}): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const roomId = await resolveRoomId();
  if (!roomId) return null;
  setCachedRoomId(roomId);

  const { useRoomSceneCollaborationStore } = await import("@/store/roomSceneCollaborationStore");
  useRoomSceneCollaborationStore.getState().setRoomContext(roomId);

  const [messages, annotations, actions] = await Promise.all([
    fetchChatMessages(roomId),
    fetchAnnotations(roomId),
    fetchActionLog(roomId),
  ]);

  handlers.setMessages(messages);
  handlers.setAnnotations(annotations);
  handlers.setActionLog(actions);

  unsubscribe?.();
  unsubscribe = subscribeRoomRealtime(roomId, {
    onMessage: (m) => handlers.appendMessage(m),
    onAnnotation: (a) => handlers.appendAnnotation(a),
    onAction: (e) => handlers.appendAction(e),
    onSceneOp: async (row) => {
      const supabase = getSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id && row.actor_id === user.id) return;
      scheduleCollaborativeSceneSync();
    },
    onRoomRowUpdate: (payload) => {
      if (!shouldHydrateFromRoomRowRealtime(payload)) return;
      scheduleCollaborativeSceneSync();
    },
  });

  return roomId;
}

export function teardownSupabaseCollaboration(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (sceneDebounce) clearTimeout(sceneDebounce);
  sceneDebounce = null;
  setCachedRoomId(null);
}
