import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import type { SceneOp, StoredSceneSnapshot } from "@/lib/scene/storedScene";
export interface ApplySceneOpResult {
  duplicate?: boolean;
  seq: number;
  scene_revision: number;
  snapshot: unknown;
  object_count?: number;
}

function mapRpcApplyResult(data: unknown): ApplySceneOpResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.duplicate === true) {
    return {
      duplicate: true,
      seq: 0,
      scene_revision: Number(d.scene_revision ?? 0),
      snapshot: d.snapshot,
    };
  }
  if (typeof d.seq !== "number" || typeof d.scene_revision !== "number") return null;
  return {
    seq: d.seq,
    scene_revision: d.scene_revision,
    snapshot: d.snapshot,
    object_count: typeof d.object_count === "number" ? d.object_count : undefined,
  };
}

export async function rpcGetRoomScene(roomId: string): Promise<unknown | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("get_room_scene", { p_room_id: roomId });
  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[flux] get_room_scene:", error.message);
    }
    return null;
  }
  return data;
}

export async function rpcApplySceneOp(
  roomId: string,
  baseRevision: number,
  op: SceneOp,
  clientOpId?: string,
): Promise<{ ok: true; result: ApplySceneOpResult } | { ok: false; code: string; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, code: "no_supabase", message: "Supabase not configured" };
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("apply_scene_op", {
    p_room_id: roomId,
    p_base_revision: baseRevision,
    p_op: op as unknown as Record<string, unknown>,
    p_client_op_id: clientOpId ?? null,
  });

  if (error) {
    const msg = error.message || "";
    if (msg.includes("stale_revision") || error.code === "P0001") {
      return { ok: false, code: "stale_revision", message: msg };
    }
    if (msg.includes("not_paused")) return { ok: false, code: "not_paused", message: msg };
    if (msg.includes("object_limit")) return { ok: false, code: "object_limit", message: msg };
    if (msg.includes("entity_not_found")) return { ok: false, code: "entity_not_found", message: msg };
    if (msg.includes("unknown_op_type")) {
      return {
        ok: false,
        code: "unknown_op_type",
        message:
          "Server does not support this edit yet (rope ops). Apply the latest Supabase migration (scene_ropes).",
      };
    }
    return { ok: false, code: error.code ?? "rpc_error", message: msg };
  }

  const result = mapRpcApplyResult(data);
  if (!result) return { ok: false, code: "bad_payload", message: "Invalid RPC response" };
  return { ok: true, result };
}

export async function rpcSetPlaybackState(
  roomId: string,
  state: "paused" | "playing",
  snapshot?: StoredSceneSnapshot,
): Promise<
  | {
      ok: true;
      playback_state: "paused" | "playing";
      playback_revision: number;
      scene_revision: number;
      snapshot: unknown;
    }
  | { ok: false; message: string }
> {
  if (!isSupabaseConfigured()) return { ok: false, message: "no supabase" };
  const supabase = getSupabase();
  const payload: {
    p_room_id: string;
    p_state: string;
    p_snapshot?: StoredSceneSnapshot;
  } = { p_room_id: roomId, p_state: state };
  if (state === "paused" && snapshot !== undefined) {
    payload.p_snapshot = snapshot;
  }
  const { data, error } = await supabase.rpc("set_playback_state", payload);  if (error) return { ok: false, message: error.message };
  if (!data || typeof data !== "object") return { ok: false, message: "bad payload" };
  const d = data as Record<string, unknown>;
  return {
    ok: true,
    playback_state: d.playback_state as "paused" | "playing",
    playback_revision: Number(d.playback_revision),
    scene_revision: Number(d.scene_revision),
    snapshot: d.snapshot,
  };
}
