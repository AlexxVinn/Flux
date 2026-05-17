import type { UserPresence } from "@flux/shared";
import { userId as toUserId } from "@flux/shared";
import { getSupabase } from "./client";

export interface RoomPresencePayload {
  displayName: string;
  color: string;
  selectedIds?: string[];
  cursor?: { x: number; y: number };
}

type PresenceMeta = Record<
  string,
  Array<{ presence_ref: string } & RoomPresencePayload>
>;

function presenceStateToPeers(
  state: PresenceMeta,
  selfKey: string,
): UserPresence[] {
  const peers: UserPresence[] = [];
  for (const [key, entries] of Object.entries(state)) {
    if (key === selfKey || !entries?.length) continue;
    const p = entries[0] as RoomPresencePayload;
    peers.push({
      userId: toUserId(key),
      displayName: p.displayName ?? "Guest",
      color: p.color ?? "#6ee7b7",
      selectedIds: p.selectedIds,
      cursor: p.cursor,
    });
  }
  return peers;
}

/**
 * Supabase Realtime presence for a room (selection + cursor without a custom WS server).
 */
export function subscribeRoomPresence(
  roomId: string,
  presenceKey: string,
  onPeers: (peers: UserPresence[]) => void,
): {
  update: (payload: RoomPresencePayload) => void;
  unsubscribe: () => void;
} {
  const supabase = getSupabase();
  const channel = supabase.channel(`room:${roomId}:presence`, {
    config: { presence: { key: presenceKey } },
  });

  const syncPeers = () => {
    const state = channel.presenceState() as PresenceMeta;
    onPeers(presenceStateToPeers(state, presenceKey));
  };

  channel
    .on("presence", { event: "sync" }, syncPeers)
    .on("presence", { event: "join" }, syncPeers)
    .on("presence", { event: "leave" }, syncPeers);

  let subscribed = false;
  let pending: RoomPresencePayload | null = null;

  void channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      subscribed = true;
      if (pending) void channel.track(pending);
      syncPeers();
    }
  });

  return {
    update: (payload: RoomPresencePayload) => {
      pending = payload;
      if (!subscribed) return;
      void channel.track(payload);
    },
    unsubscribe: () => {
      subscribed = false;
      void supabase.removeChannel(channel);
    },
  };
}
