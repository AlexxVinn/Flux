import type {
  CatalogScene,
  CreateRoomRequest,
  RoomMembership,
  RoomVisibility,
  UserScene,
} from "@flux/shared";
import { getSupabase } from "@/lib/supabase/client";
import { getOrCreateGuestId, guestDisplayLabel } from "@/lib/auth/guest";
import { countSceneObjects, normalizeStoredScene } from "@/lib/scene/storedScene";
import { rpcApplySceneOp } from "@/lib/scene/roomSceneApi";
import { catalogSnapshotForSlug } from "@/lib/education/catalogSeedSnapshots";

type RpcRoomPayload = {
  room_id: string;
  slug: string;
  title: string;
  module: string;
  visibility: RoomVisibility;
  join_code: string;
  member_id: string;
  role: RoomMembership["role"];
  display_name?: string;
};

function mapMembership(row: RpcRoomPayload): RoomMembership {
  return {
    roomId: row.room_id,
    slug: row.slug,
    title: row.title,
    module: row.module,
    visibility: row.visibility,
    joinCode: row.join_code,
    memberId: row.member_id,
    role: row.role,
    displayName: row.display_name ?? "User",
  };
}

export async function fetchCatalogScenes(): Promise<CatalogScene[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("scene_catalog")
    .select("id, slug, title, module, description, thumbnail_url, sort_order")
    .eq("is_published", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    module: row.module,
    description: row.description,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    sortOrder: row.sort_order,
  }));
}

export async function fetchUserScenes(): Promise<UserScene[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_scenes")
    .select("id, owner_id, title, module, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    module: row.module,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createRoom(req: CreateRoomRequest): Promise<RoomMembership> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("create_room", {
    p_title: req.title,
    p_module: req.module ?? "mechanics",
    p_visibility: req.visibility ?? "private",
    p_catalog_id: req.catalogId ?? null,
    p_user_scene_id: req.userSceneId ?? null,
  });

  if (error) throw new Error(mapRoomError(error.message));
  const m = mapMembership(data as RpcRoomPayload);

  let scenePayload: unknown | null =
    req.initialScene != null && typeof req.initialScene === "object" ? req.initialScene : null;

  if (!scenePayload && req.catalogId) {
    const { data: row } = await supabase
      .from("scene_catalog")
      .select("snapshot, slug")
      .eq("id", req.catalogId)
      .maybeSingle();

    const fromDb = row?.snapshot ? normalizeStoredScene(row.snapshot) : null;
    const preset = row?.slug ? catalogSnapshotForSlug(row.slug) : null;

    if (preset && (!fromDb || countSceneObjects(fromDb) === 0)) {
      scenePayload = preset;
    } else if (row?.snapshot) {
      scenePayload = row.snapshot;
    }
  }

  if (scenePayload != null && typeof scenePayload === "object") {
    const stored = normalizeStoredScene(scenePayload);
    if (countSceneObjects(stored) > 0) {
      const opResult = await rpcApplySceneOp(m.roomId, 0, {
        type: "scene.replace",
        snapshot: stored,
      });
      if (!opResult.ok) {
        throw new Error(mapSceneOpError(opResult.code, opResult.message));
      }
    }
  }

  return m;
}

export async function joinRoomByCode(
  joinCode: string,
  opts?: { asSpectator?: boolean; anonymous?: boolean },
): Promise<RoomMembership> {
  const supabase = getSupabase();
  const params: {
    p_join_code: string;
    p_as_spectator: boolean;
    p_guest_id?: string;
    p_guest_display_name?: string;
  } = {
    p_join_code: joinCode,
    p_as_spectator: opts?.asSpectator ?? false,
  };

  if (opts?.anonymous) {
    params.p_guest_id = getOrCreateGuestId();
    params.p_guest_display_name = guestDisplayLabel();
    params.p_as_spectator = true;
  }

  const { data, error } = await supabase.rpc("join_room", params);
  if (error) throw new Error(mapRoomError(error.message));
  return mapMembership(data as RpcRoomPayload);
}

export async function joinRoomBySlug(
  slug: string,
  opts?: { anonymous?: boolean },
): Promise<RoomMembership> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("rooms")
    .select("join_code")
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !data?.join_code) throw new Error("Room not found");
  return joinRoomByCode(data.join_code, opts);
}

export async function fetchPublicRooms(): Promise<
  Array<{ id: string; slug: string; title: string; module: string; joinCode: string }>
> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("rooms")
    .select("id, slug, title, module, join_code")
    .eq("visibility", "public")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  if (!data) return [];

  return data.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    module: r.module,
    joinCode: r.join_code,
  }));
}

export async function fetchRoomMembers(roomId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_members")
    .select("id, room_id, user_id, guest_id, role, display_name, joined_at")
    .eq("room_id", roomId)
    .is("kicked_at", null)
    .order("joined_at", { ascending: true });

  if (error || !data) return [];
  return data;
}

export async function kickRoomMember(memberId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("kick_room_member", { p_member_id: memberId });
  if (error) throw new Error(mapRoomError(error.message));
}

function mapSceneOpError(code: string, msg: string): string {
  if (code === "object_limit" || msg.includes("object_limit")) {
    return "This room cannot hold that many objects in the preset.";
  }
  if (msg.includes("snapshot_too_large")) return "Scene preset is too large.";
  if (code === "stale_revision") return "Could not apply preset. Try again.";
  if (code === "not_paused") return "Room must be paused to apply the preset.";
  if (process.env.NODE_ENV === "development") return msg;
  return "Could not save the starting scene.";
}

function mapRoomError(msg: string): string {
  if (msg.includes("room_not_found")) return "No room found for that code.";
  if (msg.includes("invalid_join_code")) return "Enter a valid 6-digit code.";
  if (msg.includes("kicked_from_room")) return "You were removed from this room.";
  if (msg.includes("private_room_requires_auth")) return "Sign in to join this private room.";
  if (msg.includes("not_room_admin")) return "Only the room admin can do that.";
  if (msg.includes("cannot_kick_self")) return "You cannot remove yourself.";
  if (msg.includes("cannot_kick_admin")) return "Cannot remove another admin.";
  if (msg.includes("not_authenticated")) return "Sign in to continue.";
  if (msg.includes("room_members_role_check")) return "Room membership could not be saved. Try again.";
  if (msg.includes("object_limit") || msg.includes("object_limit_reached")) {
    return "This room cannot hold that many objects.";
  }
  if (msg.includes("snapshot_too_large")) return "Scene is too large to save.";
  if (msg.includes("null value") && msg.includes("user_id")) {
    return "Could not join as guest. Please refresh and try again.";
  }
  if (process.env.NODE_ENV === "development") return msg;
  return "Room action failed. Try again.";
}
