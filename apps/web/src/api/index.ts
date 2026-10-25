import { hasBackend } from "@/lib/supabase";
import { mockApi } from "./mock";
import { supabaseApi } from "./supabase";
import type { Api } from "./types";

/** The one import every screen uses. With Supabase settings present the real backend is used, otherwise the development stand-in. */
export const api: Api = hasBackend ? supabaseApi : mockApi;
export { hasBackend };
