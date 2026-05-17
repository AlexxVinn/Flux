import { getSupabase } from "@/lib/supabase/client";

/** Realtime roster changes (insert / update / kick). */
export function subscribeRoomMembers(
  roomId: string,
  onChange: () => void,
): () => void {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`room:${roomId}:members`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_members",
        filter: `room_id=eq.${roomId}`,
      },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
