import type { UserProfile } from "@flux/shared";
import { getSupabase } from "@/lib/supabase/client";

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_color, default_name_assigned")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    avatarColor: data.avatar_color,
    defaultNameAssigned: data.default_name_assigned,
  };
}

export async function updateDisplayName(displayName: string): Promise<UserProfile> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("update_display_name", {
    p_display_name: displayName,
  });

  if (error) throw new Error(mapProfileError(error.message));

  const row = data as unknown as {
    id: string;
    display_name: string;
    avatar_color: string;
    default_name_assigned: boolean;
  };

  return {
    id: row.id,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    defaultNameAssigned: row.default_name_assigned,
  };
}

function mapProfileError(msg: string): string {
  if (msg.includes("display_name_taken")) return "That name is already taken.";
  if (msg.includes("reserved_display_name")) return "That name is reserved.";
  if (msg.includes("reserved_display_name_format")) return "Names like U_XXXXX are reserved.";
  if (msg.includes("invalid_display_name_length")) return "Name must be 3–24 characters.";
  if (msg.includes("invalid_display_name_chars")) return "Use letters, numbers, _ or - only.";
  return "Could not update display name.";
}
