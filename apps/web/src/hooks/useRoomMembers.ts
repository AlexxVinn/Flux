"use client";

import { useEffect } from "react";
import { retainRoomMembersSync, useRoomMembersStore } from "@/store/roomMembersStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";

export function useRoomMembers(enabled = true) {
  const roomId = useRoomSessionStore((s) => s.membership?.roomId);

  useEffect(() => {
    if (!enabled || !roomId) return;
    return retainRoomMembersSync(roomId);
  }, [enabled, roomId]);

  const members = useRoomMembersStore((s) => s.members);
  const loading = useRoomMembersStore((s) => s.loading);
  const error = useRoomMembersStore((s) => s.error);
  const reload = useRoomMembersStore((s) => s.reload);
  const onlineCount = useRoomMembersStore((s) => s.onlineCount);
  const totalCount = useRoomMembersStore((s) => s.totalCount);

  return {
    members,
    loading,
    error,
    reload,
    onlineCount,
    totalCount,
  };
}

/** Roster counts for badges without mounting the full members panel. */
export function useRoomMemberCounts() {
  const roomId = useRoomSessionStore((s) => s.membership?.roomId);

  useEffect(() => {
    if (!roomId) return;
    return retainRoomMembersSync(roomId);
  }, [roomId]);

  return {
    totalCount: useRoomMembersStore((s) => s.totalCount),
    onlineCount: useRoomMembersStore((s) => s.onlineCount),
  };
}
