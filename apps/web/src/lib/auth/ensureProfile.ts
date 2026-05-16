import type { UserProfile } from "@flux/shared";
import { getSupabase } from "@/lib/supabase/client";
import { fetchProfile } from "./profile";

function mapRow(row: {
  id: string;
  display_name: string;
  avatar_color: string;
  default_name_assigned: boolean;
}): UserProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    defaultNameAssigned: row.default_name_assigned,
  };
}

/** Ensures a profile row exists after auth (for accounts created before the trigger). */
export async function ensureProfile(userId: string): Promise<UserProfile | null> {
  const existing = await fetchProfile(userId);
  if (existing) return existing;

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("ensure_profile");
  if (error || !data) return null;

  return mapRow(
    data as {
      id: string;
      display_name: string;
      avatar_color: string;
      default_name_assigned: boolean;
    },
  );
}
