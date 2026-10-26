import type { County, HouseType } from "@/data/counties";

export type Role = "landlord" | "tenant" | "caretaker" | "admin";

/** Landlord journey: each step unlocks the next. Decided by the server, only displayed here. */
export type LandlordState =
  | "pending_email" | "pending_phone" | "pending_kyc" | "kyc_submitted"
  | "kyc_approved" | "active" | "expired" | "suspended";

export interface Session {
  userId: string;
  role: Role;
  name: string;
  email?: string;
  phone?: string | null;
  phoneVerified?: boolean;
  landlordState?: LandlordState;   // landlords only
  landlordOnHold?: boolean;        // tenants and caretakers: their landlord is expired or suspended
  mfa?: "ok" | "enroll" | "challenge";   // admins only: the authenticator code step
}

/** What the public may see. No landlord id, phone, email or exact location, ever. */
export interface PublicListing {
  id: string;
  title: string;
  county: County;
  town: string;
  type: HouseType;
  rent: number;
  deposit: number;
  vacant: number;
  total: number;
  amenities: string[];
  photoCount: number;
  verifiedLandlord: boolean;
}

export interface ListingFilters { county?: County; type?: HouseType }
export type LandlordHouse = PublicListing;

export interface LandlordSummary {
  rentToday: number;
  vacantUnits: number;
  totalUnits: number;
  collectedPercent: number;
  smsCredits: number;
  subscriptionDaysLeft: number;
  next: { id: string; tone: "urgent" | "info"; title: string; detail: string }[];
}

export interface SignUpInput { name: string; email: string; phone: string; password: string }
export interface KycInput { nationalId: string; kraPin: string; idFront: File; idBack: File; kra: File }
export interface KycStatus { attemptsUsed: number; maxAttempts: number; lastRejection: string | null }

export type MfaChallenge =
  | { mode: "enroll"; factorId: string; qr: string; secret: string }
  | { mode: "challenge"; factorId: string };

export type VisitStatus = "new" | "contacted" | "scheduled" | "rescheduled" | "done" | "no_show" | "house_taken" | "cancelled";
export interface AdminLandlord {
  id: string; name: string; email: string; phone: string | null; state: LandlordState; units: number; monthlyPrice: number;
  periodEnd: string | null; daysLeft: number | null; subStatus: string | null; suspendedReason: string | null;
  lastReminderAt: string | null; smsBalance: number | null;
}
export interface AdminKyc {
  id: string; landlordId: string; name: string; email: string; phone: string | null; nationalId: string; kraPin: string;
  frontPath: string; backPath: string; kraPath: string; attempt: number; createdAt: string;
}
export interface AdminPayment { id: string; landlordId: string; landlordName: string; amount: number; ref: string; paidAt: string; byAdmin: boolean }
export interface AdminCelcom { toppedUp: number; used: number; balance: number; low: boolean; monthSegments: number; monthRevenue: number; monthCost: number; monthProfit: number }
export interface AdminViewing {
  id: string; houseTitle: string; landlordName: string; visitorName: string; visitorPhone: string; preferredDate: string; timeWindow: string;
  status: VisitStatus; scheduledDate: string | null; scheduledWindow: string | null; rescheduleCount: number; adminNotes: string | null; createdAt: string;
}
export interface AdminPayout { id: string; landlordName: string; amount: number; destinationKind: string; destination: string; accountRef: string | null; status: string; ref: string | null; at: string; paidAt: string | null }
export interface ViewingPatch { status?: VisitStatus; scheduledDate?: string; scheduledWindow?: string; notes?: string }
export interface AdminApi {
  landlords(): Promise<AdminLandlord[]>;
  kycQueue(): Promise<AdminKyc[]>;
  kycFileUrl(path: string): Promise<string>;
  reviewKyc(submissionId: string, approve: boolean, reason?: string): Promise<void>;
  suspend(landlordId: string, reason: string): Promise<void>;
  resume(landlordId: string, mpesaRef: string, amount: number): Promise<void>;
  sendReminder(landlordId: string): Promise<void>;
  payments(): Promise<AdminPayment[]>;
  celcom(): Promise<AdminCelcom>;
  celcomTopup(amount: number, ref: string): Promise<void>;
  viewings(): Promise<AdminViewing[]>;
  updateViewing(id: string, patch: ViewingPatch): Promise<void>;
  payouts(): Promise<AdminPayout[]>;
  markPayoutPaid(id: string, ref: string): Promise<void>;
}

/** Everything the screens can ask of the server. The mock and the real Supabase version both fit this. */
export interface Api {
  getSession(): Promise<Session | null>;
  signInWithPassword(email: string, password: string): Promise<Session>;
  signInWithGoogle(): Promise<void>;
  signUpLandlord(input: SignUpInput): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<Session | null>;
  resendEmailCode(email: string): Promise<void>;
  syncEmailVerified(): Promise<void>;
  setMyPhone(phone: string): Promise<void>;
  sendPhoneCode(): Promise<{ expiresAt: string }>;
  verifyPhoneCode(code: string): Promise<boolean>;
  kycStatus(): Promise<KycStatus>;
  submitKyc(input: KycInput): Promise<void>;
  signOut(): Promise<void>;
  mfaBegin(): Promise<MfaChallenge>;
  mfaVerify(factorId: string, code: string): Promise<void>;
  admin: AdminApi;
  devSignIn?(role: Role): Promise<Session>;
  listListings(filters: ListingFilters): Promise<PublicListing[]>;
  landlord: LandlordApi;
  tenant: TenantApi;
  site: SiteApi;
}

// ---------------- landlord, tenant and public data ----------------
export type PaymentMode = "platform" | "own";
export interface Place { counties: { id: number; name: string }[]; towns: { id: number; countyId: number; name: string }[] }
export interface HouseInput { title: string; countyId: number; townId: number; type: HouseType; rent: number; deposit: number; total: number; vacant: number; amenities: string[]; rules: string; electricityNote: string }
export interface TenancyRow {
  id: string; houseId: string; houseTitle: string; unit: string; name: string; phone: string; emergencyName: string; emergencyPhone: string; emergencyRelationship: string;
  rent: number; deposit: number; dueDay: number; status: "active" | "notice" | "ended"; code: string; joined: boolean;
  agreementPrintedOn: string | null; agreementSignedOn: string | null; agreementPath: string | null;
  electricityEnabled: boolean; kplcPaybill: string | null; meterNumber: string | null; balance: number;
}
export interface TenantInput { houseId: string; unit: string; name: string; phone: string; emergencyName: string; emergencyPhone: string; emergencyRelationship: string; rent: number; deposit: number; dueDay: number }
export interface TenancyPatch { agreementPrintedOn?: string | null; agreementSignedOn?: string | null; electricityEnabled?: boolean; kplcPaybill?: string | null; meterNumber?: string | null }
export interface InviteResult { link: string; smsSent: boolean; expiresAt: string }
export interface VisitItem { id: string; visitorName: string; visitorPhone: string; houseTitle: string; date: string | null; window: string | null; status: string; reschedules: number }
export interface CaretakerItem { caretakerId: string; name: string; phone: string | null; houseId: string; houseTitle: string }
export interface LedgerRow { id: string; tenancyId: string; tenantName: string; unit: string; kind: "rent_payment" | "deposit_payment" | "reversal"; amount: number; method: string; ref: string; receipt: string; at: string; reversed: boolean }
export interface HeldPayment { id: string; amount: number; billRef: string | null; reason: string; at: string; ref: string }
export interface PayoutRow { id: string; amount: number; status: string; destination: string; at: string; paidAt: string | null; ref: string | null }
export interface PaymentsOverview { ledger: LedgerRow[]; held: HeldPayment[]; payouts: PayoutRow[]; destination: { kind: "mpesa_phone" | "bank_paybill"; destination: string; accountRef: string | null; verified: boolean } | null; mode: PaymentMode; owed: number }
export interface PaymentAccount { mode: PaymentMode; shortcode: string | null; status: "not_connected" | "verifying" | "connected" | "failed"; failureReason: string | null }
export interface DarajaInput { shortcode: string; consumerKey: string; consumerSecret: string; passkey: string }
export interface SmsMessage { id: string; recipient: string; body: string; segments: number; cost: number; status: string; template: string; at: string }
export interface SmsOverview { balance: number; messages: SmsMessage[]; triggers: string[]; lastRecharge: { status: string; amount: number; at: string } | null }
export interface BroadcastResult { sent: number; failed: number; skipped: number; paused: boolean }
export interface SubscriptionInfo { state: LandlordState; units: number; price: number; periodEnd: string | null; daysLeft: number | null; payments: { id: string; amount: number; ref: string; at: string }[]; lastAttempt: { status: string; at: string } | null }
export interface ComplaintMsg { id: number; mine: boolean; body: string; at: string }
export interface ComplaintItem { id: string; title: string; category: string; status: "open" | "in_progress" | "resolved"; priority: string; at: string; tenantName: string; unit: string; houseTitle: string; assignedTo: string | null; messages: ComplaintMsg[] }
export interface NoticeItem { id: string; title: string; body: string; at: string; houseId: string | null }
export type PurchasePurpose = "subscription" | "sms_recharge";

export interface LandlordApi {
  summary(): Promise<LandlordSummary>;
  houses(): Promise<LandlordHouse[]>;
  setVacantUnits(houseId: string, vacant: number): Promise<LandlordHouse>;
  places(): Promise<Place>;
  postHouse(input: HouseInput, photos: File[]): Promise<void>;
  visits(): Promise<VisitItem[]>;
  reschedule(visitId: string, date: string, window: string): Promise<void>;
  tenants(): Promise<TenancyRow[]>;
  addTenant(input: TenantInput): Promise<void>;
  endTenancy(id: string): Promise<void>;
  updateTenancy(id: string, patch: TenancyPatch): Promise<void>;
  uploadAgreement(id: string, file: File): Promise<void>;
  fileUrl(bucket: "agreements", path: string): Promise<string>;
  inviteTenant(tenancyId: string): Promise<InviteResult>;
  inviteCaretaker(houseId: string, name: string, phone: string): Promise<InviteResult>;
  caretakers(): Promise<CaretakerItem[]>;
  removeCaretaker(caretakerId: string, houseId: string): Promise<void>;
  payments(): Promise<PaymentsOverview>;
  resolveHeld(heldId: string, tenancyId: string): Promise<void>;
  reversePayment(entryId: string, reason: string): Promise<void>;
  savePayoutDestination(kind: "mpesa_phone" | "bank_paybill", destination: string, accountRef: string | null): Promise<void>;
  paymentAccount(): Promise<PaymentAccount>;
  connectDaraja(input: DarajaInput): Promise<{ status: "connected" | "failed"; reason?: string }>;
  setPaymentMode(mode: PaymentMode): Promise<void>;
  sms(): Promise<SmsOverview>;
  saveReminderTriggers(triggers: string[]): Promise<void>;
  broadcast(scope: "all" | "house" | "tenancy", targetId: string | null, message: string): Promise<BroadcastResult>;
  subscription(): Promise<SubscriptionInfo>;
  pay(purpose: PurchasePurpose, amount: number): Promise<{ message: string }>;
  complaints(): Promise<ComplaintItem[]>;
  replyComplaint(id: string, body: string): Promise<void>;
  updateComplaint(id: string, patch: { status?: ComplaintItem["status"]; priority?: string }): Promise<void>;
  postNotice(title: string, body: string, houseId: string | null): Promise<void>;
  notices(): Promise<NoticeItem[]>;
}

export interface TenantHome {
  tenancy: { id: string; houseTitle: string; unit: string; rent: number; dueDay: number; code: string; agreementPath: string | null; agreementSignedOn: string | null;
             electricityEnabled: boolean; kplcPaybill: string | null; meterNumber: string | null; emergencyName: string; emergencyPhone: string; emergencyRelationship: string };
  balance: number; charged: number; paid: number;
  history: { id: string; amount: number; kind: string; receipt: string; at: string }[];
  lastAttempt: { status: string; at: string } | null;
}
export interface TenantApi {
  home(): Promise<TenantHome | null>;
  pay(): Promise<{ message: string; amount: number }>;
  complaints(): Promise<ComplaintItem[]>;
  newComplaint(tenancyId: string, category: string, title: string, body: string): Promise<void>;
  replyComplaint(id: string, body: string): Promise<void>;
  notices(): Promise<NoticeItem[]>;
  updateEmergency(name: string, phone: string, relationship: string): Promise<void>;
  agreementUrl(path: string): Promise<string>;
}

export interface HouseDetail extends PublicListing { rules: string | null; electricityNote: string | null; photos: string[] }
export interface InviteInfo { kind: "tenant" | "caretaker"; landlordName: string | null; inviteeName: string | null; houseTitle: string; unit: string | null; phoneHint: string }
export interface VisitRequestInput { houseId: string; name: string; phone: string; date: string; window: string }
export interface SiteApi {
  house(id: string): Promise<HouseDetail | null>;
  requestVisit(input: VisitRequestInput): Promise<void>;
  inviteInfo(token: string): Promise<InviteInfo>;
  acceptInvite(token: string, email: string, password: string): Promise<void>;
}
