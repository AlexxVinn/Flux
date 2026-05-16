"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MemberRole, RoomMembership } from "@flux/shared";

interface RoomSessionState {
  membership: RoomMembership | null;
  setMembership: (m: RoomMembership | null) => void;
  clear: () => void;
}

export const useRoomSessionStore = create<RoomSessionState>()(
  persist(
    (set) => ({
      membership: null,
      setMembership: (membership) => set({ membership }),
      clear: () => set({ membership: null }),
    }),
    { name: "flux_room_session" },
  ),
);

export function useCanWriteInRoom(): boolean {
  const role = useRoomSessionStore((s) => s.membership?.role);
  return role === "admin" || role === "member";
}

export function useIsRoomAdmin(): boolean {
  return useRoomSessionStore((s) => s.membership?.role === "admin");
}

export function useRoomRole(): MemberRole | null {
  return useRoomSessionStore((s) => s.membership?.role ?? null);
}

/** Wait for persisted room session before gating workspace entry. */
export function useRoomSessionHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useRoomSessionStore.persist.hasHydrated());

  useEffect(() => {
    if (useRoomSessionStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useRoomSessionStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
