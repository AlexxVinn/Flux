import type { ActionLogEntry, CanvasAnnotation, ChatMessage } from "@flux/shared";
import { MultiplayerEventKind } from "@flux/shared";
import { pullAndApplyRemoteScene } from "@/lib/collaboration/remoteSceneSync";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { isSupabaseConfigured } from "./client";
import {
  fetchActionLog,
  fetchAnnotations,
  fetchChatMessages,
  removeRoomRealtimeChannel,
  resolveRoomId,
  setCachedRoomId,
  subscribeRoomRealtime,
} from "./roomRepository";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { useAuthStore } from "@/store/authStore";
import { getOrCreateGuestId } from "@/lib/auth/guest";
import { useMultiplayerConnectionStore } from "@/lib/multiplayer/connectionStore";
import { mpLog, mpRecordDuplicateDropped, mpRecordTransportInbound } from "@/lib/multiplayer/diagnostics";

let unsubscribe: (() => void) | null = null;
let sceneDebounce: ReturnType<typeof setTimeout> | null = null;
let pendingRemoteSeq = 0;
let activeCollabRoomId: string | null = null;
let storedHandlers: Parameters<typeof subscribeRoomRealtime>[1] | null = null;
let reconnectTimer: number | null = null;
let reconnectGeneration = 0;

function membershipRoomMatches(roomId: string): boolean {
  return useRoomSessionStore.getState().membership?.roomId === roomId;
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

function shouldHydrateFromRoomRowRealtime(payload: {
  new: Record<string, unknown>;
  old?: Record<string, unknown>;
}): boolean {
  const collab = useRoomSceneCollaborationStore.getState();
  const nextSceneRev = sceneRevisionFromRow(payload.new);
  if (nextSceneRev === null) return false;

  const prevSceneRev = sceneRevisionFromRow(payload.old);
  if (prevSceneRev !== null && nextSceneRev !== prevSceneRev) return true;

  return nextSceneRev !== collab.sceneRevision;
}

function scheduleCollaborativeSceneSync(triggerSeq?: number): void {
  if (triggerSeq !== undefined) {
    pendingRemoteSeq = Math.max(pendingRemoteSeq, triggerSeq);
  }
  if (sceneDebounce) clearTimeout(sceneDebounce);
  sceneDebounce = setTimeout(() => {
    sceneDebounce = null;
    const seq = pendingRemoteSeq;
    pendingRemoteSeq = 0;
    void pullAndApplyRemoteScene({ refitCamera: false }).then((applied) => {
      if (applied && seq > 0) {
        useRoomSceneCollaborationStore.getState().markRemoteSeqProcessed(seq);
      }
    });
  }, 80);
}

function isOwnSceneOp(actorId: string | null): boolean {
  if (!actorId) return false;
  const { user, profile } = useAuthStore.getState();
  const authId = user?.id ?? profile?.id;
  if (authId) return actorId === authId;
  const guestId = getOrCreateGuestId();
  return !!guestId && actorId === guestId;
}

function clearRealtimeReconnect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleRealtimeReconnect(roomId: string): void {
  if (!storedHandlers || activeCollabRoomId !== roomId) return;
  if (!membershipRoomMatches(roomId)) return;

  clearRealtimeReconnect();
  reconnectGeneration += 1;
  const gen = reconnectGeneration;

  const st = useMultiplayerConnectionStore.getState();
  const attempt = st.realtimeReconnectAttempt;
  const delay = Math.min(30_000, 1000 * Math.pow(2, attempt));
  st.setRealtimeReconnectAttempt(Math.min(attempt + 1, 12));
  st.setSupabaseRealtimePhase("reconnecting");
  mpLog("warn", "realtime.schedule_reconnect", { roomId, delayMs: delay, attempt });

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (gen !== reconnectGeneration) return;
    if (activeCollabRoomId !== roomId || !membershipRoomMatches(roomId)) return;

    void (async () => {
      try {
        useMultiplayerConnectionStore.getState().setSupabaseRealtimePhase("connecting");
        await attachSceneRealtime(roomId);
        useMultiplayerConnectionStore.getState().setSupabaseRealtimePhase("connected");
        useMultiplayerConnectionStore.getState().setRealtimeReconnectAttempt(0);
        void pullAndApplyRemoteScene({ refitCamera: false });
      } catch (e) {
        mpLog("error", "realtime.reconnect_failed", { roomId, err: String(e) });
        scheduleRealtimeReconnect(roomId);
      }
    })();
  }, delay);
}

function handleChannelStatus(roomId: string, status: string, err?: Error): void {
  useMultiplayerConnectionStore.getState().noteRealtimeStatus(status, err?.message ?? null);
  mpLog("info", "realtime.channel_status", { roomId, status, err: err?.message });

  if (status === "SUBSCRIBED") {
    clearRealtimeReconnect();
    useMultiplayerConnectionStore.getState().setSupabaseRealtimePhase("connected");
    useMultiplayerConnectionStore.getState().setRealtimeReconnectAttempt(0);
    void pullAndApplyRemoteScene({ refitCamera: false });
    return;
  }

  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    scheduleRealtimeReconnect(roomId);
  }
}

function buildSceneHandlers(
  handlers: {
    setMessages: (m: ChatMessage[]) => void;
    appendMessage: (m: ChatMessage) => void;
    setAnnotations: (a: CanvasAnnotation[]) => void;
    appendAnnotation: (a: CanvasAnnotation) => void;
    setActionLog: (a: ActionLogEntry[]) => void;
    appendAction: (a: ActionLogEntry) => void;
  },
  roomId: string,
): Parameters<typeof subscribeRoomRealtime>[1] {
  return {
    onMessage: (m) => {
      mpRecordTransportInbound(MultiplayerEventKind.CHAT_MESSAGE, { roomId });
      handlers.appendMessage(m);
    },
    onAnnotation: (a) => {
      mpRecordTransportInbound(MultiplayerEventKind.ANNOTATION, { roomId });
      handlers.appendAnnotation(a);
    },
    onAction: (e) => {
      mpRecordTransportInbound(MultiplayerEventKind.ENTITY_UPDATE, { roomId });
      handlers.appendAction(e);
    },
    onSceneOp: (row) => {
      mpRecordTransportInbound(MultiplayerEventKind.SCENE_OP, { roomId, seq: row.seq });
      if (!membershipRoomMatches(roomId) || activeCollabRoomId !== roomId) return;
      if (isOwnSceneOp(row.actor_id)) return;
      if (!useRoomSceneCollaborationStore.getState().shouldApplyRemoteSeq(row.seq)) {
        mpRecordDuplicateDropped(MultiplayerEventKind.SCENE_OP);
        return;
      }
      scheduleCollaborativeSceneSync(row.seq);
    },
    onRoomRowUpdate: (payload) => {
      mpRecordTransportInbound(MultiplayerEventKind.ROOM_METADATA, {
        roomId,
        version: sceneRevisionFromRow(payload.new) ?? undefined,
      });
      if (!membershipRoomMatches(roomId) || activeCollabRoomId !== roomId) return;
      if (!shouldHydrateFromRoomRowRealtime(payload)) return;
      scheduleCollaborativeSceneSync();
    },
  };
}

async function attachSceneRealtime(roomId: string): Promise<void> {
  if (!storedHandlers) return;
  unsubscribe?.();
  unsubscribe = null;
  await removeRoomRealtimeChannel(roomId);
  unsubscribe = await subscribeRoomRealtime(roomId, {
    ...storedHandlers,
    onChannelStatus: (status, err) => handleChannelStatus(roomId, status, err),
  });
}

/** After roster changes: pull Postgres snapshot only (do not rebuild Realtime listeners). */
export async function refreshRoomSceneRealtime(roomId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (activeCollabRoomId !== roomId) return;
  if (!membershipRoomMatches(roomId)) return;
  void pullAndApplyRemoteScene({ refitCamera: false });
}

export async function initSupabaseCollaboration(
  handlers: {
    setMessages: (m: ChatMessage[]) => void;
    appendMessage: (m: ChatMessage) => void;
    setAnnotations: (a: CanvasAnnotation[]) => void;
    appendAnnotation: (a: CanvasAnnotation) => void;
    setActionLog: (a: ActionLogEntry[]) => void;
    appendAction: (a: ActionLogEntry) => void;
  },
  roomIdOverride?: string | null,
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const roomId = roomIdOverride ?? (await resolveRoomId());
  if (!roomId || !membershipRoomMatches(roomId)) return null;

  useMultiplayerConnectionStore.getState().setSupabaseRealtimePhase("connecting");

  setCachedRoomId(roomId);
  activeCollabRoomId = roomId;
  storedHandlers = buildSceneHandlers(handlers, roomId);
  reconnectGeneration += 1;
  clearRealtimeReconnect();
  useMultiplayerConnectionStore.getState().setRealtimeReconnectAttempt(0);

  const { useRoomSceneCollaborationStore: sceneStore } = await import(
    "@/store/roomSceneCollaborationStore"
  );
  const scene = sceneStore.getState();
  if (!scene.collabBindKey || scene.roomId !== roomId) {
    sceneStore.getState().setRoomContext(roomId);
  }

  const [messages, annotations, actions] = await Promise.all([
    fetchChatMessages(roomId),
    fetchAnnotations(roomId),
    fetchActionLog(roomId),
  ]);

  if (!membershipRoomMatches(roomId) || activeCollabRoomId !== roomId) return null;

  handlers.setMessages(messages);
  handlers.setAnnotations(annotations);
  handlers.setActionLog(actions);

  await attachSceneRealtime(roomId);

  if (!membershipRoomMatches(roomId) || activeCollabRoomId !== roomId) {
    unsubscribe?.();
    unsubscribe = null;
    return null;
  }

  void pullAndApplyRemoteScene({ refitCamera: false });

  return roomId;
}

export function teardownSupabaseCollaboration(): void {
  const roomId = activeCollabRoomId;
  reconnectGeneration += 1;
  clearRealtimeReconnect();
  activeCollabRoomId = null;
  storedHandlers = null;
  unsubscribe?.();
  unsubscribe = null;
  if (sceneDebounce) clearTimeout(sceneDebounce);
  sceneDebounce = null;
  pendingRemoteSeq = 0;
  setCachedRoomId(null);
  useMultiplayerConnectionStore.getState().setSupabaseRealtimePhase("disconnected");
  if (roomId) void removeRoomRealtimeChannel(roomId);
}
