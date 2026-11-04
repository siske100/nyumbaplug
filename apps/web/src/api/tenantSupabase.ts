import { ApiError } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { complaintItems } from "./landlordSupabase";
import { callFunction, currentUserId, dbError, toListing } from "./helpers";
import type { HouseDetail, InviteInfo, NoticeItem, SiteApi, TenantApi, TenantHome } from "./types";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

export const tenantApi: TenantApi = {
  async home(): Promise<TenantHome | null> {
    const { data: t, error } = await supabase.from("tenancies").select("*").neq("status", "ended").limit(1).maybeSingle();
    if (error) throw dbError(error);
    if (!t) return null;
    const [h, b, l, a, route, bank, claims] = await Promise.all([
      supabase.from("houses").select("title").eq("id", t.house_id).maybeSingle(),
      supabase.from("tenancy_balances").select("balance, charged, paid").eq("tenancy_id", t.id).maybeSingle(),
      supabase.from("ledger_entries").select("id, amount, kind, receipt_no, created_at").eq("tenancy_id", t.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("payment_attempts").select("id, status, created_at").eq("tenancy_id", t.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc("tenant_payment_route"),
      supabase.rpc("tenant_manual_bank_details"),
      supabase.from("manual_rent_payment_claims").select("id, amount, transaction_message, status, submitted_at").eq("tenancy_id", t.id).order("submitted_at", { ascending: false }).limit(10),
    ]);
    if (route.error) throw dbError(route.error);
    if (bank.error) throw dbError(bank.error);
    if (claims.error) throw dbError(claims.error);
    if (route.data !== null && route.data !== "own" && route.data !== "bank_paybill") throw new ApiError(500, "Could not load your landlord's direct payment option");
    const att = a.data as Row | null;
    const manualBank = ((bank.data ?? []) as Row[])[0];
    return {
      tenancy: {
        id: t.id, houseTitle: h.data?.title ?? "", unit: t.unit_label, rent: num(t.rent_amount), dueDay: num(t.due_day), code: t.tenancy_code, agreementPath: t.agreement_file_path ?? null,
        agreementSignedOn: t.agreement_signed_on ?? null, electricityEnabled: Boolean(t.electricity_enabled), kplcPaybill: t.kplc_paybill ?? null, meterNumber: t.meter_number ?? null,
        emergencyName: t.emergency_name, emergencyPhone: t.emergency_phone, emergencyRelationship: t.emergency_relationship,
      },
      paymentMode: route.data === "own" || route.data === "bank_paybill" ? route.data : "unavailable",
      manualBank: manualBank ? {
        bankName: manualBank.bank_name as string,
        accountNumber: manualBank.account_number as string,
        accountName: manualBank.account_name as string,
      } : null,
      manualClaims: ((claims.data ?? []) as Row[]).map((r) => ({
        id: r.id as string, amount: num(r.amount), transactionMessage: r.transaction_message as string,
        status: r.status as "pending" | "received" | "rejected", submittedAt: r.submitted_at as string,
      })),
      balance: num(b.data?.balance), charged: num(b.data?.charged), paid: num(b.data?.paid),
      history: ((l.data ?? []) as Row[]).map((r) => ({ id: r.id as string, amount: num(r.amount), kind: r.kind as string, receipt: r.receipt_no as string, at: r.created_at as string })),
      lastAttempt: att ? { id: att.id as string, status: att.status as string, at: att.created_at as string } : null,
    };
  },
  pay: () => callFunction("daraja-stk"),
  async submitManualRentPayment(amount, transactionMessage) {
    const { error } = await supabase.rpc("submit_manual_rent_payment", {
      p_amount: amount, p_message: transactionMessage,
    });
    if (error) throw dbError(error);
  },
  async complaints() { return complaintItems(await currentUserId()); },
  async newComplaint(tenancyId, category, title, body) {
    const uid = await currentUserId();
    const { data, error } = await supabase.from("complaints").insert({ tenancy_id: tenancyId, category, title }).select("id").single();
    if (error || !data) throw dbError(error ?? { message: "x" });
    const m = await supabase.from("complaint_messages").insert({ complaint_id: data.id, author_id: uid, body });
    if (m.error) throw dbError(m.error);
  },
  async replyComplaint(id, body) {
    const uid = await currentUserId();
    const { error } = await supabase.from("complaint_messages").insert({ complaint_id: id, author_id: uid, body });
    if (error) throw dbError(error);
  },
  async notices(): Promise<NoticeItem[]> {
    const { data, error } = await supabase.from("notices").select("id, title, body, created_at, house_id").order("created_at", { ascending: false }).limit(100);
    if (error) throw dbError(error);
    return (data as Row[]).map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, at: r.created_at as string, houseId: (r.house_id as string | null) ?? null }));
  },
  async updateEmergency(name, phone, relationship) {
    const { error } = await supabase.rpc("update_my_emergency_contact", { p_name: name, p_phone: phone, p_relationship: relationship });
    if (error) throw error.code === "23514" ? new ApiError(422, "Enter a valid number that is different from your own") : dbError(error);
  },
  async agreementUrl(path) {
    const { data, error } = await supabase.storage.from("agreements").createSignedUrl(path, 60);
    if (error || !data) throw new ApiError(404, "We could not open that file");
    return data.signedUrl;
  },
};

export const siteApi: SiteApi = {
  async house(id): Promise<HouseDetail | null> {
    const { data, error } = await supabase.from("public_listings").select("*").eq("id", id).maybeSingle();
    if (error) throw dbError(error);
    if (!data) return null;
    const { data: ph } = await supabase.from("public_listing_photos").select("position, storage_path").eq("house_id", id).order("position");
    return {
      ...toListing(data as Row), rules: (data.rules as string | null) ?? null, electricityNote: (data.electricity_note as string | null) ?? null,
      photos: ((ph ?? []) as Row[]).map((p) => supabase.storage.from("house-photos").getPublicUrl(p.storage_path as string).data.publicUrl),
    };
  },
  async requestVisit(i) { await callFunction("visit-request", i as unknown as Record<string, unknown>); },
  inviteInfo: (token) => callFunction<InviteInfo>("invite-lookup", { token }),
  async acceptInvite(token, email, password) { await callFunction("invite-accept", { token, email, password }); },
};
