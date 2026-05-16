import { createBrowserSupabase } from "./browser";
import { isSupabaseConfigured } from "./env";

export { isSupabaseConfigured } from "./env";

export function getSupabase() {
  return createBrowserSupabase();
}
