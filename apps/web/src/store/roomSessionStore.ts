"use client";

import { create } from "zustand";
import type { MemberRole, RoomMembership } from "@flux/shared";

/**
 * Ephemeral room membership (not persisted).
 * Workspace entry always re-joins via slug/code so stale localStorage cannot desync clients.
 */
interface RoomSessionState {
  membership: RoomMembership | null;
  /**
   * Incremented on every workspace `activateRoomSession`; drives collab store rebinding
   * so re-joining the same room always resets op sequence state.
   */
  collabBindingEpoch: number;
  setMembership: (m: RoomMembership | null) => void;
  setCollabBindingEpoch: (epoch: number) => void;
  clear: () => void;
}

export const useRoomSessionStore = create<RoomSessionState>((set) => ({
  membership: null,
  collabBindingEpoch: 0,
  setMembership: (membership) => set({ membership }),
  setCollabBindingEpoch: (collabBindingEpoch) => set({ collabBindingEpoch }),
  clear: () => set({ membership: null, collabBindingEpoch: 0 }),
}));

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

/** No persist rehydration — membership is resolved on each workspace entry. */
export function useRoomSessionHydrated(): boolean {
  return true;
}
