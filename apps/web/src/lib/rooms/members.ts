import type { MemberRole, UserPresence } from "@flux/shared";
import { colorFromSeed, resolveAvatarColor } from "@/lib/collaboration/avatar";

export type MemberPresenceStatus = "online" | "away" | "offline";

export interface RoomMember {
  id: string;
  roomId: string;
  userId: string | null;
  guestId: string | null;
  role: MemberRole;
  displayName: string;
  joinedAt: string;
}

export interface EnrichedRoomMember extends RoomMember {
  avatarSeed: string;
  avatarColor: string;
  presence: MemberPresenceStatus;
  isSelf: boolean;
  isGuest: boolean;
}

export type RoomMemberRow = {
  id: string;
  user_id: string | null;
  guest_id: string | null;
  role: string;
  display_name: string;
  joined_at: string;
  room_id: string;
};

export function mapRoomMemberRow(row: RoomMemberRow): RoomMember {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    guestId: row.guest_id,
    role: row.role as MemberRole,
    displayName: row.display_name?.trim() || "Member",
    joinedAt: row.joined_at,
  };
}

function presenceMatchesMember(peer: UserPresence, member: RoomMember): boolean {
  if (member.userId && peer.userId === member.userId) return true;
  if (member.guestId && peer.userId === member.guestId) return true;
  const a = member.displayName.trim().toLowerCase();
  const b = peer.displayName.trim().toLowerCase();
  return a.length > 0 && a === b;
}

export function enrichRoomMembers(
  members: RoomMember[],
  opts: {
    selfMemberId: string | null;
    selfUserId: string | null;
    peers: UserPresence[];
    connected: boolean;
    profileColor?: string | null;
  },
): EnrichedRoomMember[] {
  const { selfMemberId, selfUserId, peers, connected, profileColor } = opts;

  return members.map((member) => {
    const avatarSeed = member.userId ?? member.guestId ?? member.id;
    const isSelf = selfMemberId === member.id;
    const isGuest = !member.userId && !!member.guestId;

    let presence: MemberPresenceStatus = "offline";
    if (isSelf) {
      presence = connected ? "online" : "away";
    } else if (peers.some((p) => presenceMatchesMember(p, member))) {
      presence = "online";
    }

    const avatarColor = isSelf
      ? resolveAvatarColor(avatarSeed, profileColor)
      : colorFromSeed(avatarSeed);

    return {
      ...member,
      avatarSeed,
      avatarColor,
      presence,
      isSelf,
      isGuest,
    };
  });
}

export function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  admin: "Admin",
  member: "Member",
  spectator: "Spectator",
};
