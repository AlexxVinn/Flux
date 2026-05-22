import type { UserScene } from "@flux/shared";
import type { StoredSceneSnapshot } from "@/lib/scene/storedScene";
import { countSceneObjects, normalizeStoredScene } from "@/lib/scene/storedScene";
import { getSupabase } from "@/lib/supabase/client";

const USER_SCENE_LIMIT = 3;

function mapRow(row: {
  id: string;
  owner_id: string;
  title: string;
  module: string;
  created_at: string;
  updated_at: string;
}): UserScene {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    module: row.module,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserSceneError(msg: string): string {
  if (msg.includes("scene_limit_reached")) {
    return `You can save up to ${USER_SCENE_LIMIT} scenes. Delete one to save a new scene.`;
  }
  if (msg.includes("not_authenticated")) return "Sign in to save scenes.";
  if (process.env.NODE_ENV === "development") return msg;
  return "Could not save scene. Try again.";
}

export async function fetchUserSceneSnapshot(sceneId: string): Promise<StoredSceneSnapshot | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_scenes")
    .select("snapshot")
    .eq("id", sceneId)
    .maybeSingle();

  if (error || !data?.snapshot) return null;
  return normalizeStoredScene(data.snapshot);
}

export async function saveUserScene(input: {
  title: string;
  module?: string;
  snapshot: StoredSceneSnapshot;
}): Promise<UserScene> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to save scenes");

  const stored = normalizeStoredScene(input.snapshot);
  if (countSceneObjects(stored) === 0) {
    throw new Error("Add at least one object before saving.");
  }

  const { data, error } = await supabase
    .from("user_scenes")
    .insert({
      owner_id: user.id,
      title: input.title.trim() || "Untitled scene",
      module: input.module ?? "mechanics",
      snapshot: stored as unknown as Record<string, unknown>,
    })
    .select("id, owner_id, title, module, created_at, updated_at")
    .single();

  if (error) throw new Error(mapUserSceneError(error.message));
  return mapRow(data);
}

export async function updateUserScene(
  sceneId: string,
  patch: { title?: string; snapshot?: StoredSceneSnapshot },
): Promise<UserScene> {
  const supabase = getSupabase();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    update.title = patch.title.trim() || "Untitled scene";
  }
  if (patch.snapshot !== undefined) {
    const stored = normalizeStoredScene(patch.snapshot);
    if (countSceneObjects(stored) === 0) {
      throw new Error("Add at least one object before saving.");
    }
    update.snapshot = stored;
  }

  const { data, error } = await supabase
    .from("user_scenes")
    .update(update)
    .eq("id", sceneId)
    .select("id, owner_id, title, module, created_at, updated_at")
    .single();

  if (error) throw new Error(mapUserSceneError(error.message));
  return mapRow(data);
}

export async function renameUserScene(sceneId: string, title: string): Promise<UserScene> {
  return updateUserScene(sceneId, { title });
}

export async function deleteUserScene(sceneId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("user_scenes").delete().eq("id", sceneId);
  if (error) throw new Error(mapUserSceneError(error.message));
}

export interface PublicUserScene {
  id: string;
  title: string;
  module: string;
  snapshot: StoredSceneSnapshot;
  isPublic: boolean;
  ownerId: string;
}

export async function fetchSharedUserScene(sceneId: string): Promise<PublicUserScene | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_scenes")
    .select("id, owner_id, title, module, snapshot, is_public")
    .eq("id", sceneId)
    .maybeSingle();

  if (error || !data?.snapshot) return null;
  return {
    id: data.id,
    ownerId: data.owner_id,
    title: data.title,
    module: data.module,
    snapshot: normalizeStoredScene(data.snapshot),
    isPublic: data.is_public,
  };
}

export async function setUserScenePublic(sceneId: string, isPublic: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("user_scenes")
    .update({ is_public: isPublic, updated_at: new Date().toISOString() })
    .eq("id", sceneId);

  if (error) throw new Error(mapUserSceneError(error.message));
}

export function buildSceneShareUrl(sceneId: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/s/${sceneId}`;
  }
  return `/s/${sceneId}`;
}

export { USER_SCENE_LIMIT };
