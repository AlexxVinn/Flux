import type { RoomMembership } from "@flux/shared";

const STORAGE_KEY = "flux_recent_rooms";
const MAX_RECENT = 5;

export interface RecentRoomEntry {
  roomId: string;
  slug: string;
  module: string;
  title: string;
  joinCode: string;
  visitedAt: string;
}

function readAll(): RecentRoomEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentRoomEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as RecentRoomEntry).roomId === "string" &&
        typeof (e as RecentRoomEntry).slug === "string" &&
        typeof (e as RecentRoomEntry).module === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(entries: RecentRoomEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENT)));
}

/** Record a room visit (most recent first, dedupe by roomId). */
export function recordRecentRoom(membership: RoomMembership): void {
  const entry: RecentRoomEntry = {
    roomId: membership.roomId,
    slug: membership.slug,
    module: membership.module,
    title: membership.title,
    joinCode: membership.joinCode,
    visitedAt: new Date().toISOString(),
  };
  const rest = readAll().filter((e) => e.roomId !== entry.roomId);
  writeAll([entry, ...rest]);
}

export function getRecentRooms(): RecentRoomEntry[] {
  return readAll();
}

export function removeRecentRoom(roomId: string): void {
  writeAll(readAll().filter((e) => e.roomId !== roomId));
}

export { MAX_RECENT };
