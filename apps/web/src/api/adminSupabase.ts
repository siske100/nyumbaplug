import { ApiError } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { callFunction, dbError } from "./helpers";
import type { AdminApi, AdminKyc, AdminLandlord, AdminPayment, AdminPayout, AdminViewing, LandlordState, VisitStatus } from "./types";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

export const adminApi: AdminApi = {
  async landlords() {
    const { data, error } = await supabase.from("admin_landlord_overview").select("*").order("full_name");
    if (error) throw dbError(error);
    return (data as Row[]).map((r): AdminLandlord => ({
      id: r.landlord_id as string, name: (r.full_name as string) ?? "(no name)", email: (r.email as string) ?? "", phone: (r.phone as string | null) ?? null,
      state: r.landlord_state as LandlordState, units: num(r.units), monthlyPrice: num(r.monthly_price),
      periodEnd: (r.period_end as string | null) ?? null, daysLeft: r.days_left === null || r.days_left === undefined ? null : num(r.days_left),
      subStatus: (r.sub_status as string | null) ?? null, suspendedReason: (r.suspended_reason as string | null) ?? null,
      lastReminderAt: (r.last_reminder_at as string | null) ?? null, smsBalance: r.sms_balance === null || r.sms_balance === undefined ? null : num(r.sms_balance),
    }));
  },

  async kycQueue() {
    const { data, error } = await supabase.from("admin_kyc_queue").select("*").eq("status", "pending").order("created_at");
    if (error) throw dbError(error);
    return (data as Row[]).map((r): AdminKyc => ({
      id: r.id as string, landlordId: r.landlord_id as string, name: (r.full_name as string) ?? "(no name)", email: (r.email as string) ?? "",
      phone: (r.phone as string | null) ?? null, nationalId: r.national_id as string, kraPin: r.kra_pin as string,
      frontPath: r.id_front_path as string, backPath: r.id_back_path as string, kraPath: r.kra_path as string,
      attempt: num(r.attempt), createdAt: r.created_at as string,
    }));
  },
  async kycFileUrl(path) {
    // A link that works for one minute, made only for the admin who asked.
    const { data, error } = await supabase.storage.from("kyc-documents").createSignedUrl(path, 60);
    if (error || !data) throw new ApiError(404, "We could not open that file");
    return data.signedUrl;
  },
  async reviewKyc(submissionId, approve, reason) {
    const { error } = await supabase.rpc("review_kyc", { p_submission: submissionId, p_approve: approve, p_reason: reason ?? null });
    if (error) throw dbError(error);
  },

  async suspend(landlordId, reason) {
    const { error } = await supabase.rpc("admin_suspend_landlord", { p_landlord: landlordId, p_reason: reason });
    if (error) throw dbError(error);
  },
  async resume(landlordId, mpesaRef, amount) {
    const { error } = await supabase.rpc("admin_resume_landlord", { p_landlord: landlordId, p_ref: mpesaRef, p_amount: amount });
    if (error) throw dbError(error);
  },
  async sendReminder(landlordId) { await callFunction("admin-send-reminder", { landlordId }); },

  async payments() {
    const { data, error } = await supabase.from("admin_subscription_payments").select("*").order("paid_at", { ascending: false }).limit(200);
    if (error) throw dbError(error);
    return (data as Row[]).map((r): AdminPayment => ({
      id: r.id as string, landlordId: r.landlord_id as string, landlordName: (r.full_name as string) ?? "(no name)",
      amount: num(r.amount_kes), ref: r.provider_ref as string, paidAt: r.paid_at as string, byAdmin: Boolean(r.recorded_by_admin),
    }));
  },

  async celcom() {
    const [bal, month] = await Promise.all([
      supabase.from("admin_celcom_balance").select("*").maybeSingle(),
      supabase.from("admin_sms_month").select("*").maybeSingle(),
    ]);
    if (bal.error) throw dbError(bal.error);
    if (month.error) throw dbError(month.error);
    return {
      toppedUp: num(bal.data?.topped_up), used: num(bal.data?.used), balance: num(bal.data?.balance), low: bal.data?.low ?? true,
      monthSegments: num(month.data?.segments_sold), monthRevenue: num(month.data?.revenue_kes), monthCost: num(month.data?.cost_kes), monthProfit: num(month.data?.profit_kes),
    };
  },
  async celcomTopup(amount, ref) {
    const { error } = await supabase.rpc("admin_celcom_topup", { p_amount: amount, p_ref: ref });
    if (error) throw error.code === "23505" ? new ApiError(409, "That payment reference was already recorded") : dbError(error);
  },

  async viewings() {
    const { data, error } = await supabase.from("admin_viewings").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw dbError(error);
    return (data as Row[]).map((r): AdminViewing => ({
      id: r.id as string, houseTitle: r.house_title as string, landlordName: (r.landlord_name as string) ?? "", visitorName: r.visitor_name as string,
      visitorPhone: r.visitor_phone as string, preferredDate: r.preferred_date as string, timeWindow: r.time_window as string, status: r.status as VisitStatus,
      scheduledDate: (r.scheduled_date as string | null) ?? null, scheduledWindow: (r.scheduled_window as string | null) ?? null,
      rescheduleCount: num(r.reschedule_count), adminNotes: (r.admin_notes as string | null) ?? null, createdAt: r.created_at as string,
    }));
  },
  async updateViewing(id, patch) {
    const update: Row = {};
    if (patch.status) update.status = patch.status;
    if (patch.scheduledDate) update.scheduled_date = patch.scheduledDate;
    if (patch.scheduledWindow) update.scheduled_window = patch.scheduledWindow;
    if (patch.notes !== undefined) update.admin_notes = patch.notes.trim() || null;
    const { error } = await supabase.from("visit_requests").update(update).eq("id", id);
    if (error) throw dbError(error);
  },
  async payouts() {
    const { data, error } = await supabase.from("admin_payouts").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw dbError(error);
    return (data as Row[]).map((r): AdminPayout => ({
      id: r.id as string, landlordName: (r.full_name as string) ?? "(no name)", amount: num(r.amount), destinationKind: r.destination_kind as string, destination: r.destination as string,
      accountRef: (r.account_ref as string | null) ?? null, status: r.status as string, ref: (r.provider_ref as string | null) ?? null, at: r.created_at as string, paidAt: (r.paid_at as string | null) ?? null,
    }));
  },
  async markPayoutPaid(id, ref) {
    const { error } = await supabase.rpc("admin_mark_payout_paid", { p_payout: id, p_ref: ref });
    if (error) throw dbError(error);
  },
};
