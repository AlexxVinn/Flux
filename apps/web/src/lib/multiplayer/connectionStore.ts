"use client";

import { create } from "zustand";

/**
 * High-level connection phases for UX and recovery logic.
 * Supabase Realtime and optional cursor WebSocket are tracked separately.
 */
export type ConnectionPhase =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "syncing";

interface MultiplayerConnectionState {
  supabaseRealtimePhase: ConnectionPhase;
  lastRealtimeStatus: string | null;
  lastRealtimeErrorMessage: string | null;
  lastSuccessfulSyncAt: number | null;
  realtimeReconnectAttempt: number;

  wsPhase: ConnectionPhase;
  lastWsPingAt: number | null;
  lastWsPongAt: number | null;
  wsReconnectAttempt: number;

  packetsReceived: number;
  duplicatesDropped: number;
  lastDesyncReason: string | null;

  setSupabaseRealtimePhase: (p: ConnectionPhase) => void;
  noteRealtimeStatus: (status: string, errMessage?: string | null) => void;
  setRealtimeReconnectAttempt: (n: number) => void;
  noteSyncSuccess: () => void;

  setWsPhase: (p: ConnectionPhase) => void;
  noteWsPing: () => void;
  noteWsPong: (ts: number) => void;
  setWsReconnectAttempt: (n: number) => void;

  incrementPacketIn: () => void;
  incrementDuplicateDropped: () => void;
  setLastDesyncReason: (r: string | null) => void;

  reset: () => void;
}

const initial = {
  supabaseRealtimePhase: "disconnected" as ConnectionPhase,
  lastRealtimeStatus: null as string | null,
  lastRealtimeErrorMessage: null as string | null,
  lastSuccessfulSyncAt: null as number | null,
  realtimeReconnectAttempt: 0,
  wsPhase: "disconnected" as ConnectionPhase,
  lastWsPingAt: null as number | null,
  lastWsPongAt: null as number | null,
  wsReconnectAttempt: 0,
  packetsReceived: 0,
  duplicatesDropped: 0,
  lastDesyncReason: null as string | null,
};

export const useMultiplayerConnectionStore = create<MultiplayerConnectionState>((set) => ({
  ...initial,

  setSupabaseRealtimePhase: (p) => set({ supabaseRealtimePhase: p }),

  noteRealtimeStatus: (status, errMessage = null) =>
    set({
      lastRealtimeStatus: status,
      lastRealtimeErrorMessage: errMessage,
    }),

  setRealtimeReconnectAttempt: (n) => set({ realtimeReconnectAttempt: n }),

  noteSyncSuccess: () => set({ lastSuccessfulSyncAt: Date.now() }),

  setWsPhase: (p) => set({ wsPhase: p }),

  noteWsPing: () => set({ lastWsPingAt: Date.now() }),

  noteWsPong: (ts) => set({ lastWsPongAt: ts }),

  setWsReconnectAttempt: (n) => set({ wsReconnectAttempt: n }),

  incrementPacketIn: () =>
    set((s) => ({ packetsReceived: s.packetsReceived + 1 })),

  incrementDuplicateDropped: () =>
    set((s) => ({ duplicatesDropped: s.duplicatesDropped + 1 })),

  setLastDesyncReason: (r) => set({ lastDesyncReason: r }),

  reset: () => set({ ...initial }),
}));
