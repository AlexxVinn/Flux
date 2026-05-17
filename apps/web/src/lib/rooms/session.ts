import type { RoomMembership } from "@flux/shared";
import { joinRoomByCode, joinRoomBySlug } from "@/lib/rooms/api";
import { setCachedRoomId } from "@/lib/supabase/roomRepository";
import {
  clearPendingRoomJoin,
  PENDING_JOIN_ANONYMOUS_KEY,
  PENDING_JOIN_CODE_KEY,
  stashPendingRoomJoin,
} from "@/lib/physics/testLayouts";
import { useRoomSessionStore } from "@/store/roomSessionStore";

/** Persist membership + pending re-join code (in-memory store; navigation uses sessionStorage code). */
export function commitRoomMembership(
  membership: RoomMembership,
  opts?: { anonymous?: boolean },
): void {
  stashPendingRoomJoin(membership, opts?.anonymous ?? false);
  setCachedRoomId(membership.roomId);
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
  const current = useRoomSessionStore.getState().membership;
  if (membershipMatchesRoute(current, module, slug)) {
    clearPendingRoomJoin();
    return current!;
  }

  if (typeof window !== "undefined") {
    const pendingCode = sessionStorage.getItem(PENDING_JOIN_CODE_KEY);
    if (pendingCode) {
      const anonymous =
        sessionStorage.getItem(PENDING_JOIN_ANONYMOUS_KEY) === "1" || !!opts?.anonymous;
      try {
        const joined = await joinRoomByCode(pendingCode, { anonymous });
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
