import { ApiError } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { callFunction, dbError } from "./helpers";
import type {
  MarketplaceApi, MarketplaceBooking, MarketplaceListing, MarketplaceListingInput,
  MarketplaceMarketerDashboard, MarketplaceSettlement,
} from "./types";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

function publicListing(r: Row): MarketplaceListing {
  return {
    id: r.id as string, title: r.title as string, description: r.description as string,
    county: r.county as string, town: r.town as string, type: r.house_type as MarketplaceListing["type"],
    rent: num(r.rent_amount), viewingFee: num(r.viewing_fee), marketerName: r.marketer_name as string,
  };
}

function booking(r: Row, paymentStatus?: string): MarketplaceBooking {
  return {
    id: r.id as string, listingId: r.listing_id as string, listingTitle: r.listing_title as string,
    county: r.county_name as string, town: r.town_name as string, marketerName: r.marketer_name as string,
    clientName: r.client_name as string, phone: r.booking_phone as string,
    date: r.viewing_date as string, timeWindow: r.time_window as string, amount: num(r.amount),
    status: r.status as MarketplaceBooking["status"], paymentStatus,
    paymentReceipt: (r.payment_receipt as string | null) ?? null, submittedAt: r.created_at as string,
  };
}

export const marketplaceApi: MarketplaceApi = {
  async publicListings(county) {
    let q = supabase.from("marketplace_public_listings").select("*").order("title");
    if (county) q = q.eq("county", county);
    const { data, error } = await q;
    if (error) throw dbError(error);
    return (data ?? []).map((r) => publicListing(r as Row));
  },
  async publicListing(id) {
    const { data, error } = await supabase.from("marketplace_public_listings").select("*").eq("id", id).maybeSingle();
    if (error) throw dbError(error);
    return data ? publicListing(data as Row) : null;
  },
  async marketerDashboard(): Promise<MarketplaceMarketerDashboard> {
    const [account, listingsResult, bookingsResult, attemptResult] = await Promise.all([
      supabase.from("marketplace_marketers").select("status, activated_at").maybeSingle(),
      supabase.from("marketplace_listings").select("id, title, description, county_id, town_id, house_type, rent_amount, viewing_fee, active").order("created_at", { ascending: false }),
      supabase.from("marketplace_bookings").select("*").order("viewing_date", { ascending: true }).limit(100),
      supabase.from("platform_attempts").select("status").eq("purpose", "marketer_activation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (account.error) throw dbError(account.error);
    if (listingsResult.error) throw dbError(listingsResult.error);
    if (bookingsResult.error) throw dbError(bookingsResult.error);
    if (attemptResult.error) throw dbError(attemptResult.error);
    if (!account.data) throw new ApiError(403, "Marketer account not found");
    const active = account.data.status === "active";
    return {
      active, activatedAt: (account.data.activated_at as string | null) ?? null,
      activationStatus: (attemptResult.data?.status as string | null) ?? null,
      listings: ((listingsResult.data ?? []) as Row[]).map((r) => ({
        id: r.id as string, title: r.title as string, description: r.description as string,
        countyId: num(r.county_id), townId: num(r.town_id), type: r.house_type as MarketplaceListingInput["type"],
        rent: num(r.rent_amount), viewingFee: num(r.viewing_fee), active: Boolean(r.active),
      })),
      bookings: ((bookingsResult.data ?? []) as Row[]).map((r) => booking(r)),
    };
  },
  async saveListing(input) {
    const { error } = await supabase.rpc("save_marketplace_listing", {
      p_id: input.id, p_title: input.title, p_description: input.description,
      p_county: input.countyId, p_town: input.townId, p_type: input.type,
      p_rent: input.rent, p_viewing_fee: input.viewingFee, p_active: input.active,
    });
    if (error) throw dbError(error);
  },
  payActivation: () => callFunction("platform-pay", { purpose: "marketer_activation", amount: 699 }),
  async clientBookings() {
    const { data, error } = await supabase.from("marketplace_bookings").select("*").order("viewing_date", { ascending: false }).limit(100);
    if (error) throw dbError(error);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return [];
    const attempts = await supabase.from("platform_attempts").select("reference_id, status").eq("purpose", "viewing_fee")
      .in("reference_id", rows.map((r) => r.id as string)).order("created_at", { ascending: false });
    if (attempts.error) throw dbError(attempts.error);
    const paymentStatus = new Map<string, string>();
    for (const a of attempts.data ?? []) if (a.reference_id && !paymentStatus.has(a.reference_id)) paymentStatus.set(a.reference_id, a.status as string);
    return rows.map((r) => booking(r, paymentStatus.get(r.id as string)));
  },
  async createBooking(listingId, date, timeWindow) {
    const { data, error } = await supabase.rpc("create_marketplace_booking", {
      p_listing: listingId, p_date: date, p_window: timeWindow,
    });
    if (error) throw dbError(error);
    if (typeof data !== "string") throw new ApiError(500, "The viewing booking could not be created");
    return data;
  },
  payViewingFee: (bookingId, amount) => callFunction("platform-pay", {
    purpose: "viewing_fee", referenceId: bookingId, amount,
  }),
  async confirmViewing(bookingId) {
    const { error } = await supabase.rpc("confirm_marketplace_viewing", { p_booking: bookingId });
    if (error) throw dbError(error);
  },
  async settlements(): Promise<MarketplaceSettlement[]> {
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
  async settleBooking(bookingId, action, reference) {
    const { error } = await supabase.rpc("admin_settle_marketplace_booking", {
      p_booking: bookingId, p_action: action, p_ref: reference,
    });
    if (error) throw dbError(error);
  },
};
