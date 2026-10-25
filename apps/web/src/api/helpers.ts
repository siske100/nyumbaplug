import { FunctionsHttpError, type PostgrestError } from "@supabase/supabase-js";
import type { County, HouseType } from "@/data/counties";
import { ApiError } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import type { PublicListing } from "./types";

/** Turn a database or storage error into one safe message. Messages from our own rules (P0001) are meant for people. */
export function dbError(e: PostgrestError | { message: string; code?: string; status?: number }): ApiError {
  const code = "code" in e ? e.code : undefined;
  if (code === "P0001") return new ApiError(400, e.message);
  if (code === "23514") return new ApiError(422, "That value is not allowed");
  if (code === "23505") return new ApiError(409, "That already exists");
  if (code === "42501" || code === "PGRST301" || ("status" in e && e.status === 401)) return new ApiError(401, "Sign in to continue");
  if (code === "PGRST116") return new ApiError(404, "Not found");
  return new ApiError(500, "Something went wrong. Please try again.");
}

export async function callFunction<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context.status;
      const detail = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(status, detail?.error ?? "Something went wrong. Please try again.");
    }
    throw new ApiError(503, "We could not reach the server. Check your connection.");
  }
  return data as T;
}

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ApiError(401, "Sign in to continue");
  return data.user.id;
}

export const toListing = (r: Record<string, unknown>): PublicListing => ({
  id: r.id as string, title: r.title as string, county: r.county as County, town: r.town as string,
  type: r.house_type as HouseType, rent: r.rent_amount as number, deposit: r.deposit_amount as number,
  vacant: r.vacant_units as number, total: r.total_units as number, amenities: (r.amenities as string[]) ?? [],
  photoCount: (r.photo_count as number) ?? 0, verifiedLandlord: Boolean(r.verified_landlord),
});

export const iso = (v: unknown): string => String(v ?? "");
