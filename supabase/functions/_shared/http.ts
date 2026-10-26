import { createClient, type User } from "npm:@supabase/supabase-js@2";

import { HttpError } from "./ops.ts";
export { HttpError };

const env = (k: string) => Deno.env.get(k);
export const mustEnv = (k: string) => { const v = env(k); if (!v) throw new Error(`Missing setting ${k}`); return v; };

/** Only our own site may call these functions from a browser. */
function corsHeaders(req: Request): Record<string, string> {
  const allowed = env("APP_ORIGIN");
  const origin = req.headers.get("Origin");
  const h: Record<string, string> = { "Vary": "Origin", "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (allowed && origin === allowed) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] = "authorization, content-type, apikey, x-client-info";
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return h;
}

export const adminClient = () => createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

export async function requireUser(req: Request): Promise<User> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to continue");
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sign in to continue");
  return data.user;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 2_000) throw new HttpError(413, "Request too large");
  try { const v = JSON.parse(text || "{}"); if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>; }
  catch { /* fall through */ }
  throw new HttpError(400, "Invalid request");
}

export function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    const headers = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    try {
      return new Response(JSON.stringify(await fn(req)), { status: 200, headers });
    } catch (e) {
      if (e instanceof HttpError) return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers });
      console.error("unhandled", e);
      return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), { status: 500, headers });
    }
  };
}

/** The caller must be an admin who has passed their authenticator code. The database decides, using the caller's own session. */
export async function requireAdmin(req: Request): Promise<User> {
  const user = await requireUser(req);
  const { data, error } = await userClient(req).rpc("is_admin");
  if (error || data !== true) throw new HttpError(403, "Not allowed");
  return user;
}

/** A client that acts as the signed-in person, so the database's own rules apply to everything it reads. */
export const userClient = (req: Request) => createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
  global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  auth: { persistSession: false },
});
