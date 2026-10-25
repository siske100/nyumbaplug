/**
 * Development stand-in for the server. It behaves the way the real backend must:
 * identity comes from the session (never from the request), ownership is checked on every write,
 * ranges are validated, and not-yours looks identical to does-not-exist.
 * Phase 1 replaces this file with the real database and access rules. Screens do not change.
 */
import { ApiError } from "@/lib/queryClient";
import { vacantUnitsSchema } from "@/lib/validation";
import type { Api, KycStatus, LandlordHouse, LandlordSummary, ListingFilters, PublicListing, Role, Session } from "./types";

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
let currentUserId: string | null = null;
let pendingEmail = "";
let kycAttempts = 0;

const users: Record<string, Session> = {
  "u-landlord": { userId: "u-landlord", role: "landlord", name: "Wanjiku", landlordState: "active" },
  "u-tenant": { userId: "u-tenant", role: "tenant", name: "Brian" },
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

  // ---- Onboarding stand-in. In development the email and tenant/caretaker phone code is always 123456. ----
  async signUpLandlord({ name, email, phone }): Promise<void> {
    await wait(300);
    users["u-new"] = { userId: "u-new", role: "landlord", name, email, phone, landlordState: "pending_email" };
    pendingEmail = email;
  },
  async verifyEmailCode(email: string, code: string): Promise<Session | null> {
    await wait(300);
    if (email !== pendingEmail || code !== "123456") throw new ApiError(400, "That code is not right or has expired");
    currentUserId = "u-new";
    users["u-new"]!.landlordState = users["u-new"]!.phone ? "pending_kyc" : "pending_phone";
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
  admin: new Proxy({} as Api["admin"], { get: () => async () => { throw new ApiError(503, "Connect the backend to use the admin area"); } }),

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
      return houses.filter((h) => h.landlordId === s.userId).map(toPublic);
    },
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
  tenant: unavailable<Api["tenant"]>({}),
  site: unavailable<Api["site"]>({}),
};
