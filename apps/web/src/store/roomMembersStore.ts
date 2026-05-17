"use client";

import { create } from "zustand";
import { fetchRoomMembers } from "@/lib/rooms/api";
import {
  enrichRoomMembers,
  mapRoomMemberRow,
  type EnrichedRoomMember,
  type RoomMember,
} from "@/lib/rooms/members";
import { subscribeRoomMembers } from "@/lib/supabase/roomMembersChannel";
import { refreshRoomSceneRealtime } from "@/lib/supabase/initRoom";
import { useAuthStore } from "@/store/authStore";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";

const POLL_MS = 8_000;
const PEER_RELOAD_DEBOUNCE_MS = 600;

interface RoomMembersState {
  roomId: string | null;
  rawMembers: RoomMember[];
  members: EnrichedRoomMember[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  onlineCount: number;
  reload: () => Promise<void>;
}

export const useRoomMembersStore = create<RoomMembersState>((set, get) => ({
  roomId: null,
  rawMembers: [],
  members: [],
  loading: false,
  error: null,
  totalCount: 0,
  onlineCount: 0,
  reload: async () => {
    const roomId = get().roomId ?? useRoomSessionStore.getState().membership?.roomId;
    if (!roomId) return;
    await loadMembers(roomId);
  },
}));

function enrichRaw(raw: RoomMember[]): Pick<RoomMembersState, "members" | "totalCount" | "onlineCount"> {
  const membership = useRoomSessionStore.getState().membership;
  const profile = useAuthStore.getState().profile;
  const collab = useCollaborationStore.getState();
  const members = enrichRoomMembers(raw, {
    selfMemberId: membership?.memberId ?? null,
    selfUserId: profile?.id ?? collab.userId,
    peers: collab.peers,
    connected: collab.connected || collab.supabaseConnected,
    profileColor: profile?.avatarColor,
  });
  return {
    members,
    totalCount: members.length,
    onlineCount: members.filter((m) => m.presence === "online").length,
  };
}

function setRawMembers(raw: RoomMember[]) {
  useRoomMembersStore.setState({
    rawMembers: raw,
    ...enrichRaw(raw),
  });
}

function refreshPresenceOnly() {
  const raw = useRoomMembersStore.getState().rawMembers;
  if (raw.length === 0) return;
  useRoomMembersStore.setState(enrichRaw(raw));
}

async function loadMembers(roomId: string) {
  const prevTotal = useRoomMembersStore.getState().totalCount;
  useRoomMembersStore.setState({ loading: true, error: null, roomId });
  try {
    const rows = await fetchRoomMembers(roomId);
    setRawMembers(rows.map(mapRoomMemberRow));
    const nextTotal = useRoomMembersStore.getState().totalCount;
    if (nextTotal > prevTotal && nextTotal >= 3) {
      void refreshRoomSceneRealtime(roomId);
    }
    useRoomMembersStore.setState({ loading: false });
  } catch (e) {
    useRoomMembersStore.setState({
      loading: false,
      error: e instanceof Error ? e.message : "Could not load members",
    });
  }
}

let syncRoomId: string | null = null;
let syncRefCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubRealtime: (() => void) | null = null;
let peerDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let collabUnsub: (() => void) | null = null;

function teardownSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (peerDebounceTimer) {
    clearTimeout(peerDebounceTimer);
    peerDebounceTimer = null;
  }
  unsubRealtime?.();
  unsubRealtime = null;
  collabUnsub?.();
  collabUnsub = null;
  syncRoomId = null;
}

function beginSync(roomId: string) {
  teardownSync();
  syncRoomId = roomId;
  useRoomMembersStore.setState({
    roomId,
    rawMembers: [],
    members: [],
    totalCount: 0,
    onlineCount: 0,
    error: null,
  });

  void loadMembers(roomId);

  pollTimer = setInterval(() => void loadMembers(roomId), POLL_MS);

  unsubRealtime = subscribeRoomMembers(roomId, () => {
    void loadMembers(roomId);
  });

  collabUnsub = useCollaborationStore.subscribe((state, prev) => {
    const peersChanged = state.peers.length !== prev.peers.length;
    const connectionChanged =
      state.connected !== prev.connected ||
      state.supabaseConnected !== prev.supabaseConnected;

    if (connectionChanged) refreshPresenceOnly();

    if (peersChanged) {
      refreshPresenceOnly();
      if (peerDebounceTimer) clearTimeout(peerDebounceTimer);
      peerDebounceTimer = setTimeout(() => {
        if (syncRoomId === roomId) void loadMembers(roomId);
      }, PEER_RELOAD_DEBOUNCE_MS);
    } else if (state.peers !== prev.peers) {
      refreshPresenceOnly();
    }
  });
}

export function forceResetRoomMembersSync(): void {
  syncRefCount = 0;
  teardownSync();
  useRoomMembersStore.setState({
    roomId: null,
    rawMembers: [],
    members: [],
    totalCount: 0,
    onlineCount: 0,
    loading: false,
    error: null,
  });
}

export function retainRoomMembersSync(roomId: string | null): () => void {
  if (!roomId) return () => undefined;

  if (syncRoomId !== roomId) {
    beginSync(roomId);
  }
  syncRefCount += 1;

  return () => {
    syncRefCount = Math.max(0, syncRefCount - 1);
    if (syncRefCount === 0) {
      teardownSync();
      useRoomMembersStore.setState({
        roomId: null,
        rawMembers: [],
        members: [],
        totalCount: 0,
        onlineCount: 0,
        loading: false,
        error: null,
      });
    }
  };
}
