"use client";

import { create } from "zustand";
import type {
  ActionLogEntry,
  CanvasAnnotation,
  ChatMessage,
  UserPresence,
  AnnotationKind,
} from "@flux/shared";
import type { ExtendedClientMessage, ExtendedServerMessage } from "@flux/shared";
import { roomId, userId as toUserId } from "@flux/shared";
import type { Vec2 } from "@flux/shared";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  createDbId,
  insertActionLog,
  insertAnnotation,
  insertChatMessage,
} from "@/lib/supabase/roomRepository";
import {
  initSupabaseCollaboration,
  teardownSupabaseCollaboration,
} from "@/lib/supabase/initRoom";
import { useAuthStore } from "@/store/authStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import type { MemberRole } from "@flux/shared";

/** Set NEXT_PUBLIC_FLUX_WS_URL to enable live cursors (e.g. ws://localhost:3001). Omit to skip. */
const WS_URL =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_FLUX_WS_URL?.trim() ?? ""
    : "";

function isWebSocketEnabled(): boolean {
  return WS_URL.length > 0 && WS_URL !== "false" && WS_URL !== "off";
}

const ROOM_ID = roomId("mechanics-default");

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "user_ssr";
  const key = "flux_user_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = randomId("user");
    localStorage.setItem(key, id);
  }
  return id;
}

function getDisplayName(): string {
  if (typeof window === "undefined") return "Guest";
  const key = "flux_display_name";
  let name = localStorage.getItem(key);
  if (!name) {
    name = `Explorer ${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem(key, name);
  }
  return name;
}

interface CollaborationState {
  connected: boolean;
  supabaseConnected: boolean;
  roomDbId: string | null;
  userId: string;
  displayName: string;
  color: string;
  peers: UserPresence[];
  annotations: CanvasAnnotation[];
  messages: ChatMessage[];
  actionLog: ActionLogEntry[];
  activeAnnotationTool: AnnotationKind | null;
  draftAnnotation: Vec2[];

  connect: () => void;
  disconnect: () => void;
  sendPresence: (patch: Partial<UserPresence>) => void;
  sendCursor: (cursor: Vec2) => void;
  sendSelection: (selectedIds: string[]) => void;
  addAnnotation: (kind: AnnotationKind, points: Vec2[], text?: string, persistent?: boolean) => void;
  removeAnnotation: (id: string) => void;
  setAnnotationTool: (tool: AnnotationKind | null) => void;
  addDraftPoint: (p: Vec2) => void;
  clearDraft: () => void;
  sendChat: (text: string) => void;
  logLocalAction: (summary: string, actionType: string, entityId?: string, tick?: number) => void;
}

let socket: WebSocket | null = null;
let wsAttempted = false;

let roomDbId: string | null = null;

function syncCollaborationIdentity(
  set: (p: Partial<CollaborationState>) => void,
  get: () => CollaborationState,
): void {
  const profile = useAuthStore.getState().profile;
  const membership = useRoomSessionStore.getState().membership;
  const userId = profile?.id ?? get().userId ?? getOrCreateUserId();
  const displayName =
    membership?.displayName ?? profile?.displayName ?? getDisplayName();
  set({ userId, displayName });
}

function currentMemberRole(): MemberRole | null {
  return useRoomSessionStore.getState().membership?.role ?? null;
}

function canWriteInRoom(): boolean {
  const role = currentMemberRole();
  return role === "admin" || role === "member";
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  connected: false,
  supabaseConnected: false,
  roomDbId: null,
  userId: getOrCreateUserId(),
  displayName: getDisplayName(),
  color: "#6ee7b7",
  peers: [],
  annotations: [],
  messages: [],
  actionLog: [],
  activeAnnotationTool: null,
  draftAnnotation: [],

  connect: () => {
    if (typeof window === "undefined") return;

    syncCollaborationIdentity(set, get);

    if (isSupabaseConfigured() && !get().supabaseConnected) {
      void initSupabaseCollaboration({
        setMessages: (messages) => set({ messages }),
        appendMessage: (m) =>
          set((s) => ({
            messages: s.messages.some((x) => x.id === m.id) ? s.messages : [...s.messages, m],
          })),
        setAnnotations: (annotations) => set({ annotations }),
        appendAnnotation: (a) =>
          set((s) => ({
            annotations: s.annotations.some((x) => x.id === a.id)
              ? s.annotations
              : [...s.annotations, a],
          })),
        setActionLog: (actionLog) => set({ actionLog }),
        appendAction: (e) =>
          set((s) => ({
            actionLog: s.actionLog.some((x) => x.id === e.id)
              ? s.actionLog
              : [...s.actionLog.slice(-199), e],
          })),
      }).then((id) => {
        if (id) {
          roomDbId = id;
          set({ supabaseConnected: true, roomDbId: id });
        }
      });
    }

    if (!isWebSocketEnabled()) return;
    if (socket?.readyState === WebSocket.OPEN) return;
    if (wsAttempted && socket?.readyState === WebSocket.CONNECTING) return;
    if (wsAttempted && socket === null) return;

    wsAttempted = true;
    const ws = new WebSocket(WS_URL);
    socket = ws;

    ws.onerror = () => {
      ws.close();
    };

    ws.onopen = () => {
      const { userId, displayName } = get();
      const join: ExtendedClientMessage = {
        type: "join",
        roomId: ROOM_ID,
        userId: toUserId(userId),
        displayName,
      };
      ws.send(JSON.stringify(join));
      set({ connected: true });
      get().sendPresence({});
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ExtendedServerMessage;
        handleServerMessage(msg, set, get);
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      set({ connected: false });
      socket = null;
    };
  },

  disconnect: () => {
    socket?.close();
    socket = null;
    wsAttempted = false;
    teardownSupabaseCollaboration();
    roomDbId = null;
    set({ connected: false, supabaseConnected: false, roomDbId: null });
  },

  sendPresence: (patch) => {
    const { userId, displayName, color } = get();
    const presence: UserPresence = {
      userId: toUserId(userId),
      displayName,
      color,
      ...patch,
    };
    send({ type: "presence", roomId: ROOM_ID, presence });
  },

  sendCursor: (cursor) => {
    get().sendPresence({ cursor });
  },

  sendSelection: (selectedIds) => {
    get().sendPresence({ selectedIds });
  },

  addAnnotation: (kind, points, text, persistent = true) => {
    if (!canWriteInRoom()) return;
    const { userId, displayName } = get();
    const annotation: CanvasAnnotation = {
      id: createDbId(),
      authorId: toUserId(userId),
      authorName: displayName,
      kind,
      points,
      text,
      persistent,
      createdAt: Date.now(),
      coordinateSpace: "world",
    };
    set((s) => ({ annotations: [...s.annotations, annotation] }));
    if (roomDbId) void insertAnnotation(roomDbId, annotation, userId);
    send({ type: "annotationAdd", roomId: ROOM_ID, annotation });
  },

  removeAnnotation: (id) => {
    set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }));
    send({ type: "annotationRemove", roomId: ROOM_ID, annotationId: id });
  },

  setAnnotationTool: (activeAnnotationTool) =>
    set({ activeAnnotationTool, draftAnnotation: [] }),

  addDraftPoint: (p) =>
    set((s) => ({ draftAnnotation: [...s.draftAnnotation, p] })),

  clearDraft: () => set({ draftAnnotation: [] }),

  sendChat: (text) => {
    const t = text.trim();
    if (!t || !canWriteInRoom()) return;
    syncCollaborationIdentity(set, get);
    const { userId, displayName } = get();
    const role = currentMemberRole() ?? undefined;

    if (roomDbId) {
      void insertChatMessage(roomDbId, userId, displayName, t, role);
      return;
    }

    if (!get().connected) {
      const local: ChatMessage = {
        id: createDbId(),
        userId: toUserId(userId),
        displayName,
        text: t,
        timestamp: Date.now(),
        role,
      };
      set((s) => ({ messages: [...s.messages, local] }));
      return;
    }
    send({
      type: "chat",
      roomId: ROOM_ID,
      message: { userId: toUserId(userId), displayName, text: t },
    });
  },

  logLocalAction: (summary, actionType, entityId, tick) => {
    if (!canWriteInRoom()) return;
    syncCollaborationIdentity(set, get);
    const { userId, displayName } = get();
    const entry: ActionLogEntry = {
      id: createDbId(),
      userId: toUserId(userId),
      displayName,
      summary,
      actionType,
      entityId,
      tick,
      timestamp: Date.now(),
    };
    set((s) => ({
      actionLog: [...s.actionLog.slice(-199), entry],
    }));
    if (roomDbId) void insertActionLog(roomDbId, userId, entry);
  },
}));

function send(msg: ExtendedClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function handleServerMessage(
  msg: ExtendedServerMessage,
  set: (p: Partial<CollaborationState> | ((s: CollaborationState) => Partial<CollaborationState>)) => void,
  get: () => CollaborationState,
): void {
  switch (msg.type) {
    case "presenceSync": {
      const self = get().userId;
      const peers = msg.users.filter((u: UserPresence) => u.userId !== self);
      const me = msg.users.find((u: UserPresence) => u.userId === self);
      set({
        peers,
        ...(me?.color ? { color: me.color } : {}),
      });
      break;
    }
    case "annotationSync":
      set({ annotations: msg.annotations });
      break;
    case "annotationAdded":
      set((s) => ({
        annotations: s.annotations.some((a) => a.id === msg.annotation.id)
          ? s.annotations
          : [...s.annotations, msg.annotation],
      }));
      break;
    case "annotationRemoved":
      set((s) => ({
        annotations: s.annotations.filter((a) => a.id !== msg.annotationId),
      }));
      break;
    case "chatSync":
      set({ messages: msg.messages });
      break;
    case "chatMessage":
      set((s) => ({
        messages: s.messages.some((m) => m.id === msg.message.id)
          ? s.messages
          : [...s.messages, msg.message],
      }));
      break;
    case "actionLogged":
      set((s) => ({
        actionLog: [...s.actionLog.slice(-199), msg.entry],
      }));
      break;
    default:
      break;
  }
}
