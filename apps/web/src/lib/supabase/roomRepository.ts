import type { ActionLogEntry, CanvasAnnotation, ChatMessage } from "@flux/shared";
import { userId as toUserId } from "@flux/shared";
import { getSupabase, isSupabaseConfigured } from "./client";
import type { Database } from "./database.types";

let cachedRoomId: string | null = null;

/** Postgres `uuid` columns require RFC-4122 ids (not `log_abc` style strings). */
export function createDbId(): string {
  return crypto.randomUUID();
}

export function setCachedRoomId(roomId: string | null): void {
  cachedRoomId = roomId;
}

export async function resolveRoomId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  if (typeof window !== "undefined") {
    const { useRoomSessionStore } = await import("@/store/roomSessionStore");
    const sessionRoomId = useRoomSessionStore.getState().membership?.roomId;
    if (sessionRoomId) {
      cachedRoomId = sessionRoomId;
      return sessionRoomId;
    }
  }

  if (cachedRoomId) return cachedRoomId;

  return null;
}

export async function fetchChatMessages(roomId: string): Promise<ChatMessage[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    userId: row.guest_id ?? row.user_id ?? "unknown",
    displayName: row.display_name,
    text: row.body,
    timestamp: new Date(row.created_at).getTime(),
    role: (row as { member_role?: string | null }).member_role as ChatMessage["role"],
  })) as ChatMessage[];
}

export async function insertChatMessage(
  roomId: string,
  guestId: string,
  displayName: string,
  text: string,
  memberRole?: string,
): Promise<ChatMessage | null> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("room_messages")
    .insert({
      room_id: roomId,
      user_id: user?.id ?? null,
      guest_id: user ? null : guestId,
      display_name: displayName,
      body: text,
      member_role: memberRole ?? null,
    })
    .select()
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    userId: guestId,
    displayName: data.display_name,
    text: data.body,
    timestamp: new Date(data.created_at).getTime(),
  } as ChatMessage;
}

export async function fetchAnnotations(roomId: string): Promise<CanvasAnnotation[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_annotations")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map((row: Database["public"]["Tables"]["room_annotations"]["Row"]) => ({
    id: row.id,
    authorId: toUserId(row.guest_id ?? row.author_id ?? "guest"),
    authorName: row.author_name,
    kind: row.kind as CanvasAnnotation["kind"],
    points: (row.points as unknown as CanvasAnnotation["points"]) ?? [],
    text: row.label ?? undefined,
    persistent: row.persistent,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

export async function insertAnnotation(
  roomId: string,
  annotation: CanvasAnnotation,
  guestId: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("room_annotations").insert({
    id: annotation.id,
    room_id: roomId,
    guest_id: guestId,
    author_name: annotation.authorName,
    kind: annotation.kind,
    points: annotation.points as unknown as Database["public"]["Tables"]["room_annotations"]["Insert"]["points"],
    label: annotation.text ?? null,
    persistent: annotation.persistent,
  });
  if (error && process.env.NODE_ENV === "development") {
    console.warn("[flux] room_annotations insert failed:", error.message);
  }
}

export async function fetchActionLog(roomId: string): Promise<ActionLogEntry[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_actions")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error || !data) return [];

  return data.map((row: Database["public"]["Tables"]["room_actions"]["Row"]) => ({
    id: row.id,
    userId: toUserId(row.guest_id ?? row.user_id ?? "guest"),
    displayName: row.display_name,
    summary: row.summary,
    actionType: row.action_type,
    entityId: row.entity_id ?? undefined,
    tick: row.tick ?? undefined,
    timestamp: new Date(row.created_at).getTime(),
  })) as ActionLogEntry[];
}

export async function insertActionLog(
  roomId: string,
  guestId: string,
  entry: ActionLogEntry,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("room_actions").insert({
    id: entry.id,
    room_id: roomId,
    guest_id: guestId,
    display_name: entry.displayName,
    summary: entry.summary,
    action_type: entry.actionType,
    entity_id: entry.entityId ?? null,
    tick: entry.tick ?? null,
  });
  if (error && process.env.NODE_ENV === "development") {
    console.warn("[flux] room_actions insert failed:", error.message);
  }
}

/** Channel name passed to `supabase.channel()` (topic becomes `realtime:${name}`). */
export function roomRealtimeChannelName(roomId: string): string {
  return `room:${roomId}`;
}

function isRoomRealtimeChannel(topic: string, roomId: string): boolean {
  const name = roomRealtimeChannelName(roomId);
  return topic === `realtime:${name}` || topic === name;
}

/** Drop any existing room collab channel so a new one can register `.on()` before `subscribe()`. */
export async function removeRoomRealtimeChannel(roomId: string): Promise<void> {
  const supabase = getSupabase();
  const stale = supabase.getChannels().filter((ch) => isRoomRealtimeChannel(ch.topic, roomId));
  await Promise.all(stale.map((ch) => supabase.removeChannel(ch)));
}

export async function subscribeRoomRealtime(
  roomId: string,
  handlers: {
    onMessage?: (row: ChatMessage) => void;
    onAnnotation?: (row: CanvasAnnotation) => void;
    onAction?: (row: ActionLogEntry) => void;
    onSceneOp?: (row: {
      seq: number;
      actor_id: string | null;
      op: unknown;
      base_revision: number;
    }) => void;
    onRoomRowUpdate?: (payload: {
      new: Record<string, unknown>;
      old?: Record<string, unknown>;
    }) => void;
    /** Invoked for every Realtime channel status transition (subscribe callback). */
    onChannelStatus?: (status: string, err?: Error) => void;
  },
): Promise<() => void> {
  const supabase = getSupabase();
  await removeRoomRealtimeChannel(roomId);

  const channel = supabase
    .channel(roomRealtimeChannelName(roomId))
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as {
          id: string;
          guest_id: string | null;
          user_id: string | null;
          display_name: string;
          body: string;
          member_role: string | null;
          created_at: string;
        };
        handlers.onMessage?.({
          id: row.id,
          userId: row.guest_id ?? row.user_id ?? "unknown",
          displayName: row.display_name,
          text: row.body,
          timestamp: new Date(row.created_at).getTime(),
          role: row.member_role as ChatMessage["role"],
        } as ChatMessage);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "room_annotations",
        filter: `room_id=eq.${roomId}`,
      },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as {
          id: string;
          guest_id: string | null;
          author_id: string | null;
          author_name: string;
          kind: string;
          points: CanvasAnnotation["points"];
          label: string | null;
          persistent: boolean;
          created_at: string;
        };
        handlers.onAnnotation?.({
          id: row.id,
          authorId: toUserId(row.guest_id ?? row.author_id ?? "guest"),
          authorName: row.author_name,
          kind: row.kind as CanvasAnnotation["kind"],
          points: row.points ?? [],
          text: row.label ?? undefined,
          persistent: row.persistent,
          createdAt: new Date(row.created_at).getTime(),
        });
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "room_actions", filter: `room_id=eq.${roomId}` },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as {
          id: string;
          guest_id: string | null;
          user_id: string | null;
          display_name: string;
          summary: string;
          action_type: string;
          entity_id: string | null;
          tick: number | null;
          created_at: string;
        };
        handlers.onAction?.({
          id: row.id,
          userId: row.guest_id ?? row.user_id ?? "unknown",
          displayName: row.display_name,
          summary: row.summary,
          actionType: row.action_type,
          entityId: row.entity_id ?? undefined,
          tick: row.tick ?? undefined,
          timestamp: new Date(row.created_at).getTime(),
        } as ActionLogEntry);
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "room_scene_ops", filter: `room_id=eq.${roomId}` },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as {
          seq: number;
          actor_id: string | null;
          op: unknown;
          base_revision: number;
        };
        handlers.onSceneOp?.(row);
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
      (payload: { new: Record<string, unknown>; old?: Record<string, unknown> }) => {
        handlers.onRoomRowUpdate?.(payload);
      },
    );

  return new Promise((resolve) => {
    let settled = false;
    const teardown = () => {
      void removeRoomRealtimeChannel(roomId);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(teardown);
    };

    channel.subscribe((status, err) => {
      handlers.onChannelStatus?.(status, err);
      if (status === "SUBSCRIBED") {
        finish();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (process.env.NODE_ENV === "development") {
          console.warn("[flux] room realtime subscription:", status, err?.message ?? err);
        }
        finish();
      }
    });

    window.setTimeout(finish, 8_000);
  });
}
