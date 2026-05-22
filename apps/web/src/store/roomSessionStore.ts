"use client";

import { create } from "zustand";
import type { MemberRole, RoomMembership } from "@flux/shared";

/**
 * Ephemeral room membership (not persisted).
 * Workspace entry always re-joins via slug/code so stale localStorage cannot desync clients.
 */
interface RoomSessionState {
  membership: RoomMembership | null;
  /** Bumped on every commit; stale async leave must not wipe a newer join. */
  membershipEpoch: number;
  /** Bumped when navigating to join + on commit; stale abandon must not wipe an in-flight join. */
  joinIntentEpoch: number;
  /**
   * Incremented on every workspace `activateRoomSession`; drives collab store rebinding
   * so re-joining the same room always resets op sequence state.
   */
  collabBindingEpoch: number;
  setMembership: (m: RoomMembership | null) => void;
  setCollabBindingEpoch: (epoch: number) => void;
  bumpJoinIntent: () => number;
  clear: () => void;
}

export const useRoomSessionStore = create<RoomSessionState>((set, get) => ({
  membership: null,
  membershipEpoch: 0,
  joinIntentEpoch: 0,
  collabBindingEpoch: 0,
  setMembership: (membership) =>
    set((s) => ({
      membership,
      membershipEpoch: membership ? s.membershipEpoch + 1 : s.membershipEpoch,
    })),
  setCollabBindingEpoch: (collabBindingEpoch) => set({ collabBindingEpoch }),
  bumpJoinIntent: () => {
    const next = get().joinIntentEpoch + 1;
    set({ joinIntentEpoch: next });
    return next;
  },
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
