import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the app has been pointed at a Supabase project. Without it, the development stand-in is used. */
export const hasBackend = Boolean(url && anonKey);

// The anon key is public by design: it only lets the browser act as a visitor or as the signed-in person,
// and the database rules decide everything else. The service-role key must never appear here.
export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "public-anon-key-not-set", {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
