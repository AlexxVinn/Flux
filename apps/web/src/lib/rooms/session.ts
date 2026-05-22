import type { RoomMembership } from "@flux/shared";
import { joinRoomByCode, joinRoomBySlug } from "@/lib/rooms/api";
import { setCachedRoomId } from "@/lib/supabase/roomRepository";
import { recordRecentRoom } from "@/lib/rooms/recentRooms";
import {
  clearPendingRoomJoin,
  PENDING_JOIN_ANONYMOUS_KEY,
  PENDING_JOIN_CODE_KEY,
  readPendingRoomMembership,
  stashPendingRoomJoin,
} from "@/lib/physics/testLayouts";
import { useRoomSessionStore } from "@/store/roomSessionStore";

/**
 * Home → workspace navigation: stash join code for the workspace gate only.
 * Membership is committed in `activateRoomSession` so leave/rejoin never races a pre-set session.
 */
export function prepareRoomJoinNavigation(
  membership: RoomMembership,
  opts?: { anonymous?: boolean },
): void {
  useRoomSessionStore.getState().bumpJoinIntent();
  stashPendingRoomJoin(membership, opts?.anonymous ?? false);
  recordRecentRoom(membership);
}

/** Persist membership after the workspace session gate resolves the room. */
export function commitRoomMembership(
  membership: RoomMembership,
  opts?: { anonymous?: boolean },
): void {
  useRoomSessionStore.getState().bumpJoinIntent();
  stashPendingRoomJoin(membership, opts?.anonymous ?? false);
  setCachedRoomId(membership.roomId);
  recordRecentRoom(membership);
  useRoomSessionStore.getState().setMembership(membership);
}

export function membershipMatchesRoute(
  membership: RoomMembership | null | undefined,
  module: string,
  slug: string,
): boolean {
  return !!membership && membership.module === module && membership.slug === slug;
}

export async function resolveWorkspaceMembership(
  module: string,
  slug: string,
  opts?: { anonymous?: boolean },
): Promise<RoomMembership> {
  if (typeof window !== "undefined") {
    const pendingMembership = readPendingRoomMembership();
    if (pendingMembership && membershipMatchesRoute(pendingMembership, module, slug)) {
      clearPendingRoomJoin();
      return pendingMembership;
    }

    const pendingCode = sessionStorage.getItem(PENDING_JOIN_CODE_KEY);
    if (pendingCode) {
      const anonymous =
        sessionStorage.getItem(PENDING_JOIN_ANONYMOUS_KEY) === "1" || !!opts?.anonymous;
      try {
        const joined = await joinRoomByCode(pendingCode, { anonymous });
        clearPendingRoomJoin();
        if (membershipMatchesRoute(joined, module, slug)) {
          return joined;
        }
      } catch {
        /* stale pending code */
      }
      clearPendingRoomJoin();
    }
  }

  return joinRoomBySlug(slug, { anonymous: opts?.anonymous });
}
