import { useAuthStore } from "@/store/authStore";
import { getSupabase } from "@/lib/supabase/client";

/** Wait until AuthProvider finished and Supabase client can read session cookies. */
export async function waitForAuthReady(timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!useAuthStore.getState().initialized && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }

  const supabase = getSupabase();
  for (let i = 0; i < 40 && Date.now() < deadline; i++) {
    await supabase.auth.getSession();
    return;
  }
}
