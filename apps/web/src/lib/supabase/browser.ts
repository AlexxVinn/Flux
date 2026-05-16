import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseBrowserClient = ReturnType<typeof createBrowserClient<any>>;

let browserClient: SupabaseBrowserClient | null = null;

export function createBrowserSupabase(): SupabaseBrowserClient {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
  return browserClient;
}

export type { CookieOptions };
