import { ApiError } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { callFunction, dbError } from "./helpers";
import type { AdminApi, AdminDashboardData, AdminKyc, AdminLandlord, AdminPayment, AdminPayout, AdminPayoutDestination, LandlordState, MarketplaceSettlement, SupportRequest, VisitStatus } from "./types";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

export const adminApi: AdminApi = {
  async dashboard(): Promise<AdminDashboardData> {
    const [summary, monthly, counties, marketers] = await Promise.all([
      supabase.from("admin_dashboard_summary").select("*").maybeSingle(),
      supabase.from("admin_dashboard_daily").select("month, bookings, revenue").order("month"),
      supabase.from("admin_dashboard_counties").select("county, bookings, share"),
      supabase.from("admin_dashboard_marketer_performance").select("marketer_id, marketer_name, listings, bookings, earnings"),
    ]);
    if (summary.error) throw dbError(summary.error);
    if (monthly.error) throw dbError(monthly.error);
    if (counties.error) throw dbError(counties.error);
    if (marketers.error) throw dbError(marketers.error);
    const s = summary.data as Row | null;
    if (!s) throw new ApiError(403, "Admin dashboard data is unavailable for this account");
    return {
      totalProperties: num(s.total_properties),
      monthlyBookings: num(s.monthly_bookings),
      totalRevenue: num(s.total_revenue),
      activeMarketers: num(s.active_marketers),
      trend: (monthly.data as Row[]).map((r) => ({
        month: new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(r.month as string)),
        bookings: num(r.bookings), revenue: num(r.revenue),
      })),
      counties: (counties.data as Row[]).map((r) => ({
        county: r.county as string, bookings: num(r.bookings), share: num(r.share),
      })),
      topMarketers: (marketers.data as Row[]).map((r) => ({
        id: r.marketer_id as string, name: (r.marketer_name as string) ?? "Marketer",
        listings: num(r.listings), bookings: num(r.bookings), earnings: num(r.earnings),
      })),
    };
  },

  async bookingStatuses() {
    const { data, error } = await supabase.from("admin_dashboard_booking_statuses").select("status, booking_count").order("status");
    if (error) throw dbError(error);
    return (data as Row[]).map((r) => ({
        status: r.status as VisitStatus, count: num(r.booking_count),
    }));
  },

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

  async payouts() {
    const { data, error } = await supabase.from("admin_payouts").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw dbError(error);
    return (data as Row[]).map((r): AdminPayout => ({
      id: r.id as string, landlordName: (r.full_name as string) ?? "(no name)", amount: num(r.amount), destinationKind: r.destination_kind as string, destination: r.destination as string,
      accountRef: (r.account_ref as string | null) ?? null, status: r.status as string, ref: (r.provider_ref as string | null) ?? null, at: r.created_at as string, paidAt: (r.paid_at as string | null) ?? null,
    }));
  },
  async payoutDestinations(): Promise<AdminPayoutDestination[]> {
    const { data, error } = await supabase.from("admin_platform_payout_destinations")
      .select("landlord_id, full_name, kind, destination, account_ref, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw dbError(error);
    return (data as Row[]).map((r) => ({
      landlordId: r.landlord_id as string,
      landlordName: (r.full_name as string) ?? "(no name)",
      kind: r.kind as AdminPayoutDestination["kind"],
      destination: r.destination as string,
      accountRef: (r.account_ref as string | null) ?? null,
      updatedAt: r.updated_at as string,
    }));
  },
  async markPayoutPaid(id, ref) {
    const { error } = await supabase.rpc("admin_mark_payout_paid", { p_payout: id, p_ref: ref });
    if (error) throw dbError(error);
  },
  async marketplaceSettlements(): Promise<MarketplaceSettlement[]> {
    const { data, error } = await supabase.from("admin_marketplace_settlements").select("*").order("viewing_date");
    if (error) throw dbError(error);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id as string, date: r.viewing_date as string, timeWindow: r.time_window as string,
      amount: num(r.amount), status: r.status as MarketplaceSettlement["status"],
      bookingPhone: r.booking_phone as string, clientName: r.client_name as string,
      marketerName: r.marketer_name as string, marketerPhone: r.marketer_phone as string,
      marketerAmount: num(r.marketer_amount), platformFee: num(r.platform_fee),
    }));
  },
  async settleMarketplaceBooking(id, action, ref) {
    const { error } = await supabase.rpc("admin_settle_marketplace_booking", {
      p_booking: id, p_action: action, p_ref: ref,
    });
    if (error) throw dbError(error);
  },
  async supportRequests() {
    const { data, error } = await supabase.rpc("admin_support_requests_with_replies");
    if (error) throw dbError(error);
    return ((data ?? []) as Row[]).map((r): SupportRequest => ({
      id: r.id as string, userId: r.user_id as string, name: (r.full_name as string) ?? "Account",
      email: (r.email as string) ?? "", role: r.role as SupportRequest["role"],
      message: r.message as string, adminResponse: (r.admin_response as string | null) ?? null,
      adminRespondedAt: (r.admin_responded_at as string | null) ?? null,
      status: r.status as SupportRequest["status"], createdAt: r.created_at as string,
    }));
  },
  async replyToSupportRequest(id, response) {
    const { error } = await supabase.rpc("admin_reply_support_request", { p_request: id, p_response: response.trim() });
    if (error) throw dbError(error);
  },
  async updateSupportRequest(id, status) {
    const { error } = await supabase.rpc("admin_update_support_request", { p_request: id, p_status: status });
    if (error) throw dbError(error);
  },
};
