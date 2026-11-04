/**
 * Development stand-in for the server. It behaves the way the real backend must:
 * identity comes from the session (never from the request), ownership is checked on every write,
 * ranges are validated, and not-yours looks identical to does-not-exist.
 * Phase 1 replaces this file with the real database and access rules. Screens do not change.
 */
import { ApiError } from "@/lib/queryClient";
import { vacantUnitsSchema } from "@/lib/validation";
import type { Api, KycStatus, LandlordHouse, LandlordSummary, ListingFilters, PublicListing, Role, Session, TenantHome } from "./types";

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
let currentUserId: string | null = null;
let pendingEmail = "";
let pendingRole: Role = "landlord";
let kycAttempts = 0;

const users: Record<string, Session> = {
  "u-landlord": { userId: "u-landlord", role: "landlord", name: "Wanjiku", landlordState: "active" },
  "u-tenant": { userId: "u-tenant", role: "tenant", name: "Brian" },
  "u-marketer": { userId: "u-marketer", role: "marketer", name: "Demo Marketer", phoneVerified: true, marketerActive: true },
  "u-client": { userId: "u-client", role: "client", name: "Demo Client", phoneVerified: true },
  "u-admin": { userId: "u-admin", role: "admin", name: "Joel" },
};

type Row = LandlordHouse & { landlordId: string };
const base = { verifiedLandlord: true, deposit: 0 };
const houses: Row[] = [
  { ...base, id: "h1", landlordId: "u-landlord", title: "Bedsitters, Block B", county: "Bungoma", town: "Bungoma Town", type: "Bedsitter", rent: 6500, deposit: 6500, vacant: 2, total: 8, amenities: ["Water", "Tiled floor", "Security light"], photoCount: 6 },
  { ...base, id: "h2", landlordId: "u-landlord", title: "1 Bedrooms, Block A", county: "Bungoma", town: "Kanduyi", type: "1 Bedroom", rent: 12000, deposit: 12000, vacant: 1, total: 4, amenities: ["Water", "Parking", "Balcony"], photoCount: 5 },
  { ...base, id: "h3", landlordId: "u-landlord", title: "Single Rooms, Block C", county: "Bungoma", town: "Webuye", type: "Single Room", rent: 3500, deposit: 3500, vacant: 0, total: 4, amenities: ["Water"], photoCount: 4 },
  { ...base, id: "h4", landlordId: "u-other", title: "2 Bedroom Apartments", county: "Kakamega", town: "Kakamega Town", type: "2 Bedroom", rent: 18000, deposit: 18000, vacant: 3, total: 6, amenities: ["Water", "Parking", "Fenced compound"], photoCount: 7 },
  { ...base, id: "h5", landlordId: "u-other", title: "Bedsitters Westlands", county: "Nairobi", town: "Westlands", type: "Bedsitter", rent: 14000, deposit: 14000, vacant: 2, total: 10, amenities: ["Water", "Wifi ready", "CCTV"], photoCount: 6 },
  { ...base, id: "h6", landlordId: "u-other", title: "Single Rooms Nyali", county: "Mombasa", town: "Nyali", type: "Single Room", rent: 6000, deposit: 6000, vacant: 4, total: 12, amenities: ["Water", "Security light"], photoCount: 5 },
];
/** Anything the development stand-in does not simulate answers "connect the backend" instead of pretending. */
function unavailable<T extends object>(known: Partial<T>): T {
  return new Proxy(known as T, {
    get: (target, key) => (key in target ? (target as Record<string | symbol, unknown>)[key] : async () => { throw new ApiError(503, "Connect the backend to use this part"); }),
  });
}
export const auditLog: { at: string; userId: string; action: string; detail: string }[] = [];

function requireSession(role?: Role): Session {
  const s = currentUserId ? users[currentUserId] : undefined;
  if (!s) throw new ApiError(401, "Sign in to continue");
  if (role && s.role !== role) throw new ApiError(403, "You do not have access to this");
  return s;
}
const toPublic = ({ landlordId: _l, ...rest }: Row): PublicListing => rest;

export const mockApi: Api = {
  async getSession(): Promise<Session | null> {
    await wait(120);
    return currentUserId ? (users[currentUserId] ?? null) : null;
  },
  async signInWithPassword(_email: string, _password: string): Promise<Session> {
    await wait(400);
    // One message for every failure, so nobody can discover which emails exist.
    throw new ApiError(401, "Invalid email or password");
  },
  async signInWithGoogle(): Promise<void> {
    await wait(200);
    throw new ApiError(501, "Google sign-in turns on once the backend is connected");
  },

  // ---- Onboarding stand-in. In development the email and tenant phone code is always 123456. ----
  async signUpLandlord({ name, email, phone }): Promise<void> {
    await wait(300);
    users["u-new"] = { userId: "u-new", role: "landlord", name, email, phone, landlordState: "pending_email" };
    pendingEmail = email;
    pendingRole = "landlord";
  },
  async signUpMarketplace({ name, email, phone }, role): Promise<void> {
    await wait(300);
    users["u-new"] = { userId: "u-new", role, name, email, phone, phoneVerified: false, marketerActive: false };
    pendingEmail = email;
    pendingRole = role;
  },
  async verifyEmailCode(email: string, code: string): Promise<Session | null> {
    await wait(300);
    if (email !== pendingEmail || code !== "123456") throw new ApiError(400, "That code is not right or has expired");
    currentUserId = "u-new";
    if (pendingRole === "landlord") users["u-new"]!.landlordState = users["u-new"]!.phone ? "pending_kyc" : "pending_phone";
    return users["u-new"]!;
  },
  async resendEmailCode(): Promise<void> { await wait(200); },
  async syncEmailVerified(): Promise<void> {
    await wait(150);
    const s = requireSession("landlord");
    if (s.landlordState === "pending_email") s.landlordState = s.phone ? "pending_kyc" : "pending_phone";
  },
  async setMyPhone(phone: string): Promise<void> { await wait(150); requireSession("landlord").phone = phone; },
  async sendPhoneCode(): Promise<{ expiresAt: string }> {
    await wait(300); requireSession("landlord");
    return { expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  },
  async verifyPhoneCode(code: string): Promise<boolean> {
    await wait(300);
    const s = requireSession("landlord");
    if (code !== "123456") return false;
    s.landlordState = "pending_kyc";
    return true;
  },
  async kycStatus(): Promise<KycStatus> { await wait(100); requireSession("landlord"); return { attemptsUsed: kycAttempts, maxAttempts: 3, lastRejection: null }; },
  async submitKyc(): Promise<void> {
    await wait(500);
    const s = requireSession("landlord");
    if (s.landlordState !== "pending_kyc") throw new ApiError(400, "Documents cannot be submitted right now");
    kycAttempts++; s.landlordState = "kyc_submitted";
  },
  async devSignIn(role: Role): Promise<Session> {
    if (!import.meta.env.DEV) throw new ApiError(403, "Not available");
    await wait(150);
    const found = Object.values(users).find((u) => u.role === role);
    if (!found) throw new ApiError(404, "No demo account for that role");
    currentUserId = found.userId;
    return found;
  },
  async signOut(): Promise<void> {
    await wait(80);
    currentUserId = null;
  },

  async mfaBegin() { throw new ApiError(503, "Connect the backend to use the admin area"); },
  async mfaVerify() { throw new ApiError(503, "Connect the backend to use the admin area"); },
  admin: new Proxy(Object.assign({} as Api["admin"], {
    async dashboard() {
      await wait();
      const today = new Date();
      const trend = Array.from({ length: 30 }, (_, index) => {
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29 + index);
        return {
          month: new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date),
          bookings: 0,
          revenue: 0,
        };
      });
      return {
        totalProperties: houses.length,
        monthlyBookings: 0,
        totalRevenue: 0,
        activeMarketers: Object.values(users).filter((account) => account.role === "marketer" && account.marketerActive).length,
        trend,
        counties: [],
        topMarketers: [],
      };
    },
    async bookingStatuses() {
      await wait();
      return [
        { status: "new", count: 0 },
        { status: "contacted", count: 0 },
        { status: "scheduled", count: 0 },
        { status: "rescheduled", count: 0 },
        { status: "done", count: 0 },
        { status: "no_show", count: 0 },
        { status: "house_taken", count: 0 },
        { status: "cancelled", count: 0 },
      ];
    },
  }), {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      return async () => { throw new ApiError(503, "Connect the backend to use the admin area"); };
    },
  }),

  async listListings(filters: ListingFilters): Promise<PublicListing[]> {
    await wait();
    return houses
      .filter((h) => h.vacant > 0) // full houses never appear in search
      .filter((h) => (!filters.county || h.county === filters.county) && (!filters.type || h.type === filters.type))
      .map(toPublic);
  },

  landlord: unavailable<Api["landlord"]>({
    async summary(): Promise<LandlordSummary> {
      const s = requireSession("landlord");
      await wait();
      const mine = houses.filter((h) => h.landlordId === s.userId);
      const full = mine.find((h) => h.vacant === 0);
      const daysLeft = 5;
      return {
        rentToday: 18500,
        vacantUnits: mine.reduce((a, h) => a + h.vacant, 0),
        totalUnits: mine.reduce((a, h) => a + h.total, 0),
        collectedPercent: 88,
        smsCredits: 240,
        subscriptionDaysLeft: daysLeft,
        next: [
          { id: "arrears", tone: "urgent", title: "1 tenant is in arrears", detail: "Review the ledger and follow up before the cycle closes." },
          ...(full ? [{ id: "full", tone: "info" as const, title: `${full.title} is full`, detail: "It stays hidden from search until you add vacant units." }] : []),
          ...(daysLeft <= 7 ? [{ id: "sub", tone: "info" as const, title: `Subscription expires in ${daysLeft} days`, detail: "Renew to keep your houses listed." }] : []),
        ],
      };
    },
    async houses(): Promise<LandlordHouse[]> {
      const s = requireSession("landlord");
      await wait();
      return houses.filter((h) => h.landlordId === s.userId).map((house) => ({ ...toPublic(house), coverPhoto: "/apartment-building.jpg" }));
    },
    async tenants() { await wait(); requireSession("landlord"); return []; },
    async visits() { await wait(); requireSession("landlord"); return []; },
    async dashboardLedger() { await wait(); requireSession("landlord"); return []; },
    async setVacantUnits(houseId: string, vacant: number): Promise<LandlordHouse> {
      const s = requireSession("landlord"); // identity comes from the session, never from the request
      await wait(200);
      const row = houses.find((h) => h.id === houseId && h.landlordId === s.userId);
      if (!row) throw new ApiError(404, "House not found"); // not yours looks the same as missing
      const check = vacantUnitsSchema.safeParse({ vacant, total: row.total });
      if (!check.success) throw new ApiError(422, check.error.issues[0]?.message ?? "Invalid value");
      auditLog.push({ at: new Date().toISOString(), userId: s.userId, action: "vacant_units_changed", detail: `${row.id}: ${row.vacant} to ${vacant}` });
      row.vacant = vacant;
      return toPublic(row);
    },
  }),
  marketplace: unavailable<Api["marketplace"]>({}),
  tenant: unavailable<Api["tenant"]>({
    async home(): Promise<TenantHome> {
      requireSession("tenant");
      await wait();
      const now = new Date();
      const lastPayment = new Date(now.getFullYear(), now.getMonth() - 1, 5, 12).toISOString();
      return {
        tenancy: {
          id: "demo-tenancy",
          houseTitle: "Bedsitters, Block B",
          unit: "B3",
          rent: 6500,
          dueDay: 5,
          code: "DEMO-B3",
          agreementPath: null,
          agreementSignedOn: new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString(),
          electricityEnabled: false,
          kplcPaybill: null,
          meterNumber: null,
          emergencyName: "Mary Wanjiku",
          emergencyPhone: "0712345678",
          emergencyRelationship: "Mother",
        },
        paymentMode: "unavailable",
        manualBank: null,
        manualClaims: [],
        balance: 6500,
        charged: 13000,
        paid: 6500,
        history: [{ id: "demo-payment-1", amount: 6500, kind: "rent_payment", receipt: "DEMO12345", at: lastPayment }],
        lastAttempt: null,
      };
    },
  }),
  site: unavailable<Api["site"]>({}),
};
