import { validateKycFile } from "@rh/shared";
import { ApiError } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { adminApi } from "./adminSupabase";
import { callFunction, dbError, toListing } from "./helpers";
import { landlordApi } from "./landlordSupabase";
import { tenantApi, siteApi } from "./tenantSupabase";
import type { Api, LandlordState, Role, Session } from "./types";

const MAX_KYC_ATTEMPTS = 3;

async function adminMfaState(): Promise<"ok" | "enroll" | "challenge"> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal2") return "ok";
  const { data: f } = await supabase.auth.mfa.listFactors();
  return (f?.totp?.length ?? 0) > 0 ? "challenge" : "enroll";   // totp lists only verified factors
}

async function loadSession(): Promise<Session | null> {
  const { data: auth } = await supabase.auth.getSession();
  const user = auth.session?.user;
  if (!user) return null;
  const { data: p, error } = await supabase.from("profiles")
    .select("id, role, full_name, email, phone, phone_verified, landlord_state").eq("id", user.id).single();
  if (error || !p) throw dbError(error ?? { message: "no profile", code: "PGRST301" });

  const role = p.role as Role;
  let onHold = false;
  if (role === "tenant" || role === "caretaker") {
    // The database hides a tenancy from its tenant when the landlord is expired or suspended.
    const { count } = await supabase.from("tenancies").select("id", { count: "exact", head: true });
    onHold = (count ?? 0) === 0;
  }
  return {
    userId: p.id, role, name: p.full_name ?? user.email ?? "there", email: p.email ?? undefined, phone: p.phone, phoneVerified: Boolean(p.phone_verified),
    landlordState: (p.landlord_state as LandlordState | null) ?? undefined, landlordOnHold: onHold,
    mfa: role === "admin" ? await adminMfaState() : undefined,
  };
}

export const supabaseApi: Api = {
  getSession: loadSession,

  async signInWithPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (/not confirmed/i.test(error.message)) throw new ApiError(403, "Please confirm your email first");
      throw new ApiError(401, "Invalid email or password");            // one message for every other failure
    }
    const s = await loadSession();
    if (!s) throw new ApiError(401, "Invalid email or password");
    return s;
  },

  async signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/sign-in` } });
    if (error) throw new ApiError(500, "Google sign-in is not available right now");
  },

  async signUpLandlord({ name, email, phone, password }) {
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name, phone }, emailRedirectTo: location.origin } });
    if (error) throw new ApiError(400, /password/i.test(error.message) ? error.message : "We could not create the account. Check your details and try again.");
    // An email that is already registered looks identical to a new one, so nobody can discover who has an account.
  },

  async verifyEmailCode(email, code) {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
    if (error) throw new ApiError(400, "That code is not right or has expired");
    await callFunction("email-verified-sync");
    return loadSession();
  },
  async resendEmailCode(email) {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) throw new ApiError(429, "Please wait a minute before asking for another code");
  },
  async syncEmailVerified() { await callFunction("email-verified-sync"); },

  async setMyPhone(phone) {
    const { error } = await supabase.rpc("set_my_phone", { p_phone: phone });
    if (error) throw dbError(error);
  },
  sendPhoneCode: () => callFunction<{ expiresAt: string }>("phone-code-send"),
  async verifyPhoneCode(code) { return (await callFunction<{ verified: boolean }>("phone-code-verify", { code })).verified; },

  async kycStatus() {
    const { data, error } = await supabase.from("kyc_submissions").select("status, reject_reason, attempt").order("attempt", { ascending: false });
    if (error) throw dbError(error);
    const last = data?.[0];
    return { attemptsUsed: data?.length ?? 0, maxAttempts: MAX_KYC_ATTEMPTS, lastRejection: last?.status === "rejected" ? (last.reject_reason ?? "Documents were not accepted") : null };
  },

  async submitKyc({ nationalId, kraPin, idFront, idBack, kra }) {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) throw new ApiError(401, "Sign in to continue");

    const prepared = [];
    for (const [label, file] of [["id-front", idFront], ["id-back", idBack], ["kra", kra]] as const) {
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const check = validateKycFile(file, head);
      if (!check.ok) throw new ApiError(422, `${label.replace("-", " ")}: ${check.reason}`);
      prepared.push({ file, mime: check.mime, path: `${uid}/${crypto.randomUUID()}-${label}.${check.ext}` });
    }
    for (const p of prepared) {
      const { error } = await supabase.storage.from("kyc-documents").upload(p.path, p.file, { contentType: p.mime, upsert: false });
      if (error) throw new ApiError(400, "We could not upload your documents. Check your connection and try again.");
    }
    const { error } = await supabase.rpc("submit_kyc", { p_national_id: nationalId, p_kra_pin: kraPin, p_front: prepared[0]!.path, p_back: prepared[1]!.path, p_kra: prepared[2]!.path });
    if (error) throw dbError(error);
  },

  async signOut() { await supabase.auth.signOut(); },

  async mfaBegin() {
    if ((await adminMfaState()) === "challenge") {
      const { data } = await supabase.auth.mfa.listFactors();
      const id = data?.totp?.[0]?.id;
      if (!id) throw new ApiError(500, "Something went wrong. Please try again.");
      return { mode: "challenge" as const, factorId: id };
    }
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator" });
    if (error || !data) throw new ApiError(500, "We could not start the authenticator setup. Try again.");
    return { mode: "enroll" as const, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  },
  async mfaVerify(factorId, code) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new ApiError(400, "That code is not right. Try the newest code in your app.");
  },
  admin: adminApi,

  async listListings(filters) {
    let q = supabase.from("public_listings").select("*").order("rent_amount");
    if (filters.county) q = q.eq("county", filters.county);
    if (filters.type) q = q.eq("house_type", filters.type);
    const { data, error } = await q;
    if (error) throw dbError(error);
    return (data ?? []).map(toListing);
  },

  landlord: landlordApi,
  tenant: tenantApi,
  site: siteApi,
};
