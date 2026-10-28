import { MAX_PHOTOS, MIN_PHOTOS, priceForUnits, validateKycFile, validatePhoto } from "@rh/shared";
import { cleanPhoto } from "@/lib/photos";
import { ApiError } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { callFunction, currentUserId, dbError, toListing } from "./helpers";
import type {
  BroadcastResult, CaretakerItem, ComplaintItem, HeldPayment, HouseForEdit, HouseInput, InviteResult, LandlordApi, LandlordHouse, LandlordState, LandlordSummary, LedgerRow, NoticeItem,
  PaymentAccount, PaymentsOverview, PayoutRow, Place, SmsOverview, SubscriptionInfo, TenancyRow, VisitItem, VisitPatch, VisitStatus,
} from "./types";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const head = async (f: File) => new Uint8Array(await f.slice(0, 12).arrayBuffer());

async function myHouses(): Promise<LandlordHouse[]> {
  const { data: rows, error } = await supabase.from("houses")
    .select("id, title, house_type, rent_amount, deposit_amount, total_units, vacant_units, amenities, county_id, town_id").order("created_at");
  if (error) throw dbError(error);
  if (!rows?.length) return [];
  const [{ data: counties }, { data: towns }, { data: photos }] = await Promise.all([
    supabase.from("counties").select("id, name"),
    supabase.from("towns").select("id, name").in("id", rows.map((r) => r.town_id)),
    supabase.from("house_photos").select("house_id").in("house_id", rows.map((r) => r.id)),
  ]);
  const county = new Map((counties ?? []).map((c) => [c.id, c.name]));
  const town = new Map((towns ?? []).map((t) => [t.id, t.name]));
  return rows.map((r) => toListing({ ...r, county: county.get(r.county_id), town: town.get(r.town_id), verified_landlord: true, photo_count: (photos ?? []).filter((p) => p.house_id === r.id).length }));
}

const ok = <T>(r: { data: T | null; error: Parameters<typeof dbError>[0] | null }): T => { if (r.error) throw dbError(r.error); return r.data as T; };

async function tenancyRows(): Promise<TenancyRow[]> {
  const [t, h, b] = await Promise.all([
    supabase.from("tenancies").select("*").order("created_at", { ascending: false }),
    supabase.from("houses").select("id, title"),
    supabase.from("tenancy_balances").select("tenancy_id, balance"),
  ]);
  const title = new Map((ok(h) as Row[]).map((x) => [x.id as string, x.title as string]));
  const bal = new Map((ok(b) as Row[]).map((x) => [x.tenancy_id as string, num(x.balance)]));
  return (ok(t) as Row[]).map((r): TenancyRow => ({
    id: r.id as string, houseId: r.house_id as string, houseTitle: title.get(r.house_id as string) ?? "", unit: r.unit_label as string, name: r.tenant_name as string,
    phone: r.tenant_phone as string, emergencyName: r.emergency_name as string, emergencyPhone: r.emergency_phone as string, emergencyRelationship: r.emergency_relationship as string,
    rent: num(r.rent_amount), deposit: num(r.deposit_amount), dueDay: num(r.due_day), status: r.status as TenancyRow["status"], code: r.tenancy_code as string, joined: r.tenant_user_id != null,
    agreementPrintedOn: (r.agreement_printed_on as string | null) ?? null, agreementSignedOn: (r.agreement_signed_on as string | null) ?? null, agreementPath: (r.agreement_file_path as string | null) ?? null,
    electricityEnabled: Boolean(r.electricity_enabled), kplcPaybill: (r.kplc_paybill as string | null) ?? null, meterNumber: (r.meter_number as string | null) ?? null, balance: bal.get(r.id as string) ?? 0,
  }));
}

async function complaintItems(uid: string): Promise<ComplaintItem[]> {
  const { data, error } = await supabase.from("complaints").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw dbError(error);
  const list = (data ?? []) as Row[];
  if (!list.length) return [];
  const [m, t, h] = await Promise.all([
    supabase.from("complaint_messages").select("id, complaint_id, author_id, body, created_at").in("complaint_id", list.map((c) => c.id as string)).order("created_at"),
    supabase.from("tenancies").select("id, tenant_name, unit_label, house_id").in("id", list.map((c) => c.tenancy_id as string)),
    supabase.from("houses").select("id, title"),
  ]);
  const ten = new Map((ok(t) as Row[]).map((x) => [x.id as string, x]));
  const title = new Map((ok(h) as Row[]).map((x) => [x.id as string, x.title as string]));
  const msgs = ok(m) as Row[];
  return list.map((c): ComplaintItem => {
    const tn = ten.get(c.tenancy_id as string);
    return {
      id: c.id as string, title: c.title as string, category: c.category as string, status: c.status as ComplaintItem["status"], priority: c.priority as string, at: c.created_at as string,
      tenantName: (tn?.tenant_name as string) ?? "", unit: (tn?.unit_label as string) ?? "", houseTitle: title.get(tn?.house_id as string) ?? "", assignedTo: (c.assigned_to as string | null) ?? null,
      messages: msgs.filter((x) => x.complaint_id === c.id).map((x) => ({ id: x.id as number, mine: x.author_id === uid, body: x.body as string, at: x.created_at as string })),
    };
  });
}

export const landlordApi: LandlordApi = {
  houses: myHouses,

  async houseForEdit(houseId): Promise<HouseForEdit> {
    const { data: house, error } = await supabase.from("houses")
      .select("id, title, county_id, town_id, house_type, rent_amount, deposit_amount, total_units, vacant_units, amenities, rules, electricity_note")
      .eq("id", houseId).maybeSingle();
    if (error) throw dbError(error);
    if (!house) throw new ApiError(404, "House not found");
    const { data: photos, error: photosError } = await supabase.from("house_photos")
      .select("position, storage_path").eq("house_id", houseId).order("position");
    if (photosError) throw dbError(photosError);
    return {
      input: {
        title: house.title, countyId: house.county_id, townId: house.town_id, type: house.house_type, rent: house.rent_amount,
        deposit: house.deposit_amount, total: house.total_units, vacant: house.vacant_units, amenities: house.amenities ?? [],
        rules: house.rules ?? "", electricityNote: house.electricity_note ?? "",
      },
      photos: (photos ?? []).map((photo) => ({
        path: photo.storage_path,
        url: supabase.storage.from("house-photos").getPublicUrl(photo.storage_path).data.publicUrl,
      })),
    };
  },

  async updateHouse(houseId: string, input: HouseInput, photos: File[]): Promise<void> {
    const uid = await currentUserId();
    const { data: house, error: houseError } = await supabase.from("houses").select("id").eq("id", houseId).maybeSingle();
    if (houseError) throw dbError(houseError);
    if (!house) throw new ApiError(404, "House not found");

    const { data: currentPhotos, error: photosError } = await supabase.from("house_photos")
      .select("position, storage_path").eq("house_id", houseId).order("position");
    if (photosError) throw dbError(photosError);
    const existing = currentPhotos ?? [];
    if (existing.length + photos.length < MIN_PHOTOS) throw new ApiError(422, `Keep at least ${MIN_PHOTOS} photos on the listing`);
    if (existing.length + photos.length > MAX_PHOTOS) throw new ApiError(422, `A listing can have at most ${MAX_PHOTOS} photos`);

    const checked = [];
    for (const original of photos) {
      const file = await cleanPhoto(original);
      const result = validatePhoto(file, await head(file));
      if (!result.ok) throw new ApiError(422, `${file.name}: ${result.reason}`);
      checked.push({ file, mime: result.mime, ext: result.ext });
    }

    const usedPositions = new Set(existing.map((photo) => photo.position));
    const availablePositions = Array.from({ length: MAX_PHOTOS }, (_, position) => position).filter((position) => !usedPositions.has(position));
    const uploaded: string[] = [];
    const inserted: { house_id: string; position: number; storage_path: string }[] = [];
    try {
      for (const [index, photo] of checked.entries()) {
        const path = `${uid}/${houseId}/${crypto.randomUUID()}.${photo.ext}`;
        const result = await supabase.storage.from("house-photos").upload(path, photo.file, { contentType: photo.mime, upsert: false });
        if (result.error) throw new ApiError(400, "We could not upload your photos. Check your connection and try again.");
        uploaded.push(path);
        inserted.push({ house_id: houseId, position: availablePositions[index]!, storage_path: path });
      }

      if (inserted.length) {
        const result = await supabase.from("house_photos").insert(inserted);
        if (result.error) throw dbError(result.error);
      }

      const { data, error } = await supabase.from("houses").update({
        title: input.title, county_id: input.countyId, town_id: input.townId, house_type: input.type, rent_amount: input.rent,
        deposit_amount: input.deposit, total_units: input.total, vacant_units: input.vacant, amenities: input.amenities,
        rules: input.rules || null, electricity_note: input.electricityNote || null,
      }).eq("id", houseId).select("id").maybeSingle();
      if (error) {
        if (error.code === "23514") throw new ApiError(422, "Check the total and vacant units");
        throw dbError(error);
      }
      if (!data) throw new ApiError(404, "House not found");
    } catch (error) {
      if (uploaded.length) {
        const [rowsCleanup, filesCleanup] = await Promise.all([
          supabase.from("house_photos").delete().eq("house_id", houseId).in("storage_path", uploaded),
          supabase.storage.from("house-photos").remove(uploaded),
        ]);
        if (rowsCleanup.error || filesCleanup.error) {
          console.error("Could not clean up uploaded house photos after a listing edit failed", rowsCleanup.error, filesCleanup.error);
          throw new ApiError(500, "The listing could not be saved and uploaded photos need cleanup. Please contact support.");
        }
      }
      throw error;
    }
  },

  async setVacantUnits(houseId, vacant) {
    const { error } = await supabase.from("houses").update({ vacant_units: vacant }).eq("id", houseId);
    if (error) throw error.code === "23514" ? new ApiError(422, "Vacant units must be between 0 and the total") : dbError(error);
    const updated = (await myHouses()).find((h) => h.id === houseId);
    if (!updated) throw new ApiError(404, "House not found");
    return updated;
  },

  async summary(): Promise<LandlordSummary> {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [houses, wallet, sub, ledger, balances] = await Promise.all([
      myHouses(),
      supabase.from("sms_wallets").select("balance_kes").maybeSingle(),
      supabase.from("subscriptions").select("period_end").maybeSingle(),
      supabase.from("ledger_entries").select("kind, amount").gte("created_at", today.toISOString()),
      supabase.from("tenancy_balances").select("charged, paid, balance"),
    ]);
    const rentToday = (ledger.data ?? []).reduce((a, r) => a + (r.kind === "reversal" ? -r.amount : r.kind === "rent_payment" ? r.amount : 0), 0);
    const charged = (balances.data ?? []).reduce((a, r) => a + (r.charged ?? 0), 0);
    const paid = (balances.data ?? []).reduce((a, r) => a + (r.paid ?? 0), 0);
    const arrears = (balances.data ?? []).filter((r) => (r.balance ?? 0) > 0).length;
    const daysLeft = sub.data ? Math.max(0, Math.ceil((new Date(sub.data.period_end).getTime() - Date.now()) / 86_400_000)) : 0;
    const full = houses.find((h) => h.vacant === 0);
    return {
      rentToday, vacantUnits: houses.reduce((a, h) => a + h.vacant, 0), totalUnits: houses.reduce((a, h) => a + h.total, 0),
      collectedPercent: charged > 0 ? Math.min(100, Math.round((paid / charged) * 100)) : 100,
      smsCredits: Math.floor(Number(wallet.data?.balance_kes ?? 0) / 0.8), subscriptionDaysLeft: daysLeft,
      next: [
        ...(arrears ? [{ id: "arrears", tone: "urgent" as const, title: `${arrears} ${arrears === 1 ? "tenant has" : "tenants have"} an unpaid balance`, detail: "Review the ledger and follow up." }] : []),
        ...(full ? [{ id: "full", tone: "info" as const, title: `${full.title} is full`, detail: "It stays hidden from search until you add vacant units." }] : []),
        ...(daysLeft > 0 && daysLeft <= 7 ? [{ id: "sub", tone: "info" as const, title: `Subscription expires in ${daysLeft} days`, detail: "Renew to keep your houses listed." }] : []),
      ],
    };
  },

  async places(): Promise<Place> {
    const [c, t] = await Promise.all([supabase.from("counties").select("id, name").order("name"), supabase.from("towns").select("id, county_id, name").order("name")]);
    return { counties: ok(c) as Place["counties"], towns: (ok(t) as Row[]).map((x) => ({ id: x.id as number, countyId: x.county_id as number, name: x.name as string })) };
  },

  async postHouse(input, photos) {
    if (photos.length < 3 || photos.length > 7) throw new ApiError(422, "Add between 3 and 7 photos");
    const uid = await currentUserId();
    const checked = [];
    for (const original of photos) {
      const f = await cleanPhoto(original);          // strips hidden data such as GPS location, and shrinks the file
      const c = validatePhoto(f, await head(f));
      if (!c.ok) throw new ApiError(422, `${f.name}: ${c.reason}`);
      checked.push({ file: f, mime: c.mime, ext: c.ext });
    }
    const { data: house, error } = await supabase.from("houses").insert({
      landlord_id: uid, title: input.title, county_id: input.countyId, town_id: input.townId, house_type: input.type, rent_amount: input.rent, deposit_amount: input.deposit,
      total_units: input.total, vacant_units: input.vacant, amenities: input.amenities, rules: input.rules || null, electricity_note: input.electricityNote || null,
    }).select("id").single();
    if (error || !house) throw error?.code === "23514" ? new ApiError(422, "Check the units and rent") : dbError(error ?? { message: "x" });

    const uploaded: string[] = [];
    try {
      for (const c of checked) {
        const path = `${uid}/${house.id}/${crypto.randomUUID()}.${c.ext}`;
        const up = await supabase.storage.from("house-photos").upload(path, c.file, { contentType: c.mime, upsert: false });
        if (up.error) throw new ApiError(400, "We could not upload your photos. Check your connection and try again.");
        uploaded.push(path);
      }
      const rows = uploaded.map((storage_path, position) => ({ house_id: house.id, position, storage_path }));
      const ins = await supabase.from("house_photos").insert(rows);
      if (ins.error) throw dbError(ins.error);
    } catch (e) {
      await supabase.from("houses").delete().eq("id", house.id);                 // never leave a half-made listing behind
      if (uploaded.length) await supabase.storage.from("house-photos").remove(uploaded);
      throw e;
    }
  },

  async visits(): Promise<VisitItem[]> {
    const [v, h] = await Promise.all([
      supabase.from("visit_requests").select("id, house_id, visitor_name, visitor_phone, preferred_date, time_window, status, scheduled_date, scheduled_window, reschedule_count").order("created_at", { ascending: false }).limit(100),
      supabase.from("houses").select("id, title"),
    ]);
    const title = new Map((ok(h) as Row[]).map((x) => [x.id as string, x.title as string]));
    return (ok(v) as Row[]).map((r): VisitItem => ({
      id: r.id as string, visitorName: r.visitor_name as string, visitorPhone: r.visitor_phone as string, houseTitle: title.get(r.house_id as string) ?? "",
      preferredDate: r.preferred_date as string, timeWindow: r.time_window as string,
      scheduledDate: (r.scheduled_date as string | null) ?? null, scheduledWindow: (r.scheduled_window as string | null) ?? null,
      status: r.status as VisitStatus, reschedules: num(r.reschedule_count),
    }));
  },
  async updateVisit(visitId: string, patch: VisitPatch) {
    const update: Row = {};
    if (patch.status) update.status = patch.status;
    if (patch.scheduledDate) update.scheduled_date = patch.scheduledDate;
    if (patch.scheduledWindow) update.scheduled_window = patch.scheduledWindow;
    const { data, error } = await supabase.from("visit_requests").update(update).eq("id", visitId).select("id").maybeSingle();
    if (error) throw dbError(error);
    if (!data) throw new ApiError(404, "Viewing not found");
  },
  async reschedule(visitId, date, window) {
    const { error } = await supabase.rpc("reschedule_visit", { p_request: visitId, p_date: date, p_window: window });
    if (error) throw dbError(error);
  },

  tenants: tenancyRows,
  async addTenant(i) {
    const uid = await currentUserId();
    const { error } = await supabase.from("tenancies").insert({
      landlord_id: uid, house_id: i.houseId, unit_label: i.unit, tenant_name: i.name, tenant_phone: i.phone, emergency_name: i.emergencyName, emergency_phone: i.emergencyPhone,
      emergency_relationship: i.emergencyRelationship, rent_amount: i.rent, deposit_amount: i.deposit, due_day: i.dueDay,
    });
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "That unit already has a tenant");
      if (error.code === "23514") throw new ApiError(422, "Check the phone numbers. The emergency contact must be a different person.");
      throw dbError(error);
    }
  },
  async endTenancy(id) {
    const { error } = await supabase.from("tenancies").update({ status: "ended" }).eq("id", id);
    if (error) throw dbError(error);
  },
  async updateTenancy(id, p) {
    const u: Row = {};
    if (p.agreementPrintedOn !== undefined) u.agreement_printed_on = p.agreementPrintedOn;
    if (p.agreementSignedOn !== undefined) u.agreement_signed_on = p.agreementSignedOn;
    if (p.electricityEnabled !== undefined) u.electricity_enabled = p.electricityEnabled;
    if (p.kplcPaybill !== undefined) u.kplc_paybill = p.kplcPaybill;
    if (p.meterNumber !== undefined) u.meter_number = p.meterNumber;
    const { error } = await supabase.from("tenancies").update(u).eq("id", id);
    if (error) throw error.code === "23514" ? new ApiError(422, "Enter the KPLC paybill (5 to 7 digits) and the meter number (digits only)") : dbError(error);
  },
  async uploadAgreement(id, file) {
    const uid = await currentUserId();
    const c = validateKycFile(file, await head(file));
    if (!c.ok) throw new ApiError(422, c.reason);
    const path = `${uid}/${id}/${crypto.randomUUID()}.${c.ext}`;
    const up = await supabase.storage.from("agreements").upload(path, file, { contentType: c.mime, upsert: false });
    if (up.error) throw new ApiError(400, "We could not upload the file. Check your connection and try again.");
    const { error } = await supabase.from("tenancies").update({ agreement_file_path: path }).eq("id", id);
    if (error) throw dbError(error);
  },
  async fileUrl(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data) throw new ApiError(404, "We could not open that file");
    return data.signedUrl;
  },
  inviteTenant: (tenancyId) => callFunction<InviteResult>("invite-create", { kind: "tenant", tenancyId }),
  inviteCaretaker: (houseId, name, phone) => callFunction<InviteResult>("invite-create", { kind: "caretaker", houseId, name, phone }),
  async caretakers(): Promise<CaretakerItem[]> {
    const { data, error } = await supabase.from("my_caretakers").select("*");
    if (error) throw dbError(error);
    return (data as Row[]).map((r) => ({ caretakerId: r.caretaker_id as string, name: (r.full_name as string) ?? "(not named yet)", phone: (r.phone as string | null) ?? null, houseId: r.house_id as string, houseTitle: r.house_title as string }));
  },
  async removeCaretaker(caretakerId, houseId) {
    const { error } = await supabase.from("caretaker_assignments").delete().eq("caretaker_id", caretakerId).eq("house_id", houseId);
    if (error) throw dbError(error);
  },

  async payments(): Promise<PaymentsOverview> {
    const [l, t, h, p, d, a, b] = await Promise.all([
      supabase.from("ledger_entries").select("id, tenancy_id, kind, amount, method, provider_ref, receipt_no, reverses_id, created_at").order("created_at", { ascending: false }).limit(150),
      supabase.from("tenancies").select("id, tenant_name, unit_label"),
      supabase.from("held_payments").select("id, amount, bill_ref, reason, provider_ref, created_at").is("resolved_at", null).order("created_at", { ascending: false }),
      supabase.from("payouts").select("id, amount, status, destination, created_at, paid_at, provider_ref").order("created_at", { ascending: false }).limit(50),
      supabase.from("payout_destinations").select("kind, destination, account_ref, verified").maybeSingle(),
      supabase.from("payment_accounts").select("mode").maybeSingle(),
      supabase.from("tenancy_balances").select("balance"),
    ]);
    const who = new Map((ok(t) as Row[]).map((x) => [x.id as string, x]));
    const rows = ok(l) as Row[];
    const reversed = new Set(rows.filter((r) => r.reverses_id).map((r) => r.reverses_id as string));
    const dest = ok(d) as Row | null;
    return {
      ledger: rows.map((r): LedgerRow => ({ id: r.id as string, tenancyId: r.tenancy_id as string, tenantName: (who.get(r.tenancy_id as string)?.tenant_name as string) ?? "", unit: (who.get(r.tenancy_id as string)?.unit_label as string) ?? "",
        kind: r.kind as LedgerRow["kind"], amount: num(r.amount), method: r.method as string, ref: r.provider_ref as string, receipt: r.receipt_no as string, at: r.created_at as string, reversed: reversed.has(r.id as string) })),
      held: (ok(h) as Row[]).map((r): HeldPayment => ({ id: r.id as string, amount: num(r.amount), billRef: (r.bill_ref as string | null) ?? null, reason: r.reason as string, at: r.created_at as string, ref: r.provider_ref as string })),
      payouts: (ok(p) as Row[]).map((r): PayoutRow => ({ id: r.id as string, amount: num(r.amount), status: r.status as string, destination: r.destination as string, at: r.created_at as string, paidAt: (r.paid_at as string | null) ?? null, ref: (r.provider_ref as string | null) ?? null })),
      destination: dest ? { kind: dest.kind as "mpesa_phone" | "bank_paybill", destination: dest.destination as string, accountRef: (dest.account_ref as string | null) ?? null, verified: Boolean(dest.verified) } : null,
      mode: ((ok(a) as Row | null)?.mode as "platform" | "own") ?? "platform",
      owed: (ok(b) as Row[]).reduce((s, r) => s + Math.max(0, num(r.balance)), 0),
    };
  },
  async resolveHeld(heldId, tenancyId) { const { error } = await supabase.rpc("resolve_held_payment", { p_held: heldId, p_tenancy: tenancyId }); if (error) throw dbError(error); },
  async reversePayment(entryId, reason) { const { error } = await supabase.rpc("reverse_payment", { p_entry: entryId, p_reason: reason }); if (error) throw dbError(error); },
  async savePayoutDestination(kind, destination, accountRef) {
    const uid = await currentUserId();
    const existing = await supabase.from("payout_destinations").select("landlord_id").maybeSingle();
    const r = existing.data
      ? await supabase.from("payout_destinations").update({ kind, destination, account_ref: accountRef }).eq("landlord_id", uid)
      : await supabase.from("payout_destinations").insert({ landlord_id: uid, kind, destination, account_ref: accountRef });
    if (r.error) throw r.error.code === "23514" ? new ApiError(422, "Check the destination details") : dbError(r.error);
  },

  async paymentAccount(): Promise<PaymentAccount> {
    const { data, error } = await supabase.from("payment_accounts").select("mode, shortcode, status, failure_reason").maybeSingle();
    if (error || !data) throw dbError(error ?? { message: "x", code: "PGRST116" });
    return { mode: data.mode, shortcode: data.shortcode, status: data.status, failureReason: data.failure_reason };
  },
  connectDaraja: (input) => callFunction("payments-connect", input as unknown as Record<string, unknown>),
  async setPaymentMode(mode) { const { error } = await supabase.rpc("set_payment_mode", { p_mode: mode }); if (error) throw dbError(error); },

  async sms(): Promise<SmsOverview> {
    const [w, m, s, a] = await Promise.all([
      supabase.from("sms_wallets").select("balance_kes").maybeSingle(),
      supabase.from("sms_messages").select("id, recipient, body, segments, cost_kes, status, template, created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("reminder_schedules").select("triggers").maybeSingle(),
      supabase.from("platform_attempts").select("status, amount, created_at").eq("purpose", "sms_recharge").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const att = ok(a) as Row | null;
    return {
      balance: num((ok(w) as Row | null)?.balance_kes),
      messages: (ok(m) as Row[]).map((r): SmsMessage2 => ({ id: r.id as string, recipient: r.recipient as string, body: r.body as string, segments: num(r.segments), cost: num(r.cost_kes), status: r.status as string, template: r.template as string, at: r.created_at as string })),
      triggers: ((ok(s) as Row | null)?.triggers as string[] | undefined) ?? ["2d", "due"],
      lastRecharge: att ? { status: att.status as string, amount: num(att.amount), at: att.created_at as string } : null,
    };
  },
  async saveReminderTriggers(triggers) {
    const uid = await currentUserId();
    const existing = await supabase.from("reminder_schedules").select("landlord_id").maybeSingle();
    const r = existing.data ? await supabase.from("reminder_schedules").update({ triggers }).eq("landlord_id", uid) : await supabase.from("reminder_schedules").insert({ landlord_id: uid, triggers });
    if (r.error) throw dbError(r.error);
  },
  broadcast: (scope, targetId, message) => callFunction<BroadcastResult>("sms-broadcast", { scope, targetId, message }),

  async subscription(): Promise<SubscriptionInfo> {
    const uid = await currentUserId();
    const [p, s, pay, att, houses] = await Promise.all([
      supabase.from("profiles").select("landlord_state").eq("id", uid).single(),
      supabase.from("subscriptions").select("period_end").maybeSingle(),
      supabase.from("subscription_payments").select("id, amount_kes, provider_ref, paid_at").order("paid_at", { ascending: false }).limit(24),
      supabase.from("platform_attempts").select("status, created_at").eq("purpose", "subscription").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("houses").select("total_units"),
    ]);
    const units = (ok(houses) as Row[]).reduce((a, r) => a + num(r.total_units), 0);
    const end = (ok(s) as Row | null)?.period_end as string | undefined;
    const lastAttempt = ok(att) as Row | null;
    return {
      state: (ok(p) as Row).landlord_state as LandlordState, units, price: priceForUnits(units), periodEnd: end ?? null,
      daysLeft: end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000) : null,
      payments: (ok(pay) as Row[]).map((r) => ({ id: r.id as string, amount: num(r.amount_kes), ref: r.provider_ref as string, at: r.paid_at as string })),
      lastAttempt: lastAttempt ? { status: lastAttempt.status as string, at: lastAttempt.created_at as string } : null,
    };
  },
  pay: (purpose, amount) => callFunction<{ message: string }>("platform-pay", { purpose, amount }),

  async complaints() { return complaintItems(await currentUserId()); },
  async replyComplaint(id, body) {
    const uid = await currentUserId();
    const { error } = await supabase.from("complaint_messages").insert({ complaint_id: id, author_id: uid, body });
    if (error) throw dbError(error);
  },
  async updateComplaint(id, patch) {
    const { error } = await supabase.from("complaints").update(patch).eq("id", id);
    if (error) throw dbError(error);
  },
  async postNotice(title, body, houseId) {
    const uid = await currentUserId();
    const { error } = await supabase.from("notices").insert({ landlord_id: uid, house_id: houseId, title, body });
    if (error) throw dbError(error);
  },
  async notices(): Promise<NoticeItem[]> {
    const { data, error } = await supabase.from("notices").select("id, title, body, created_at, house_id").order("created_at", { ascending: false }).limit(100);
    if (error) throw dbError(error);
    return (data as Row[]).map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, at: r.created_at as string, houseId: (r.house_id as string | null) ?? null }));
  },
};
type SmsMessage2 = import("./types").SmsMessage;
export { complaintItems };
