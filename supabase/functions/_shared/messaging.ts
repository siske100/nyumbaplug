// SMS operations: landlord-paid messages, broadcasts, rent reminders, and the visitor and invite messages.
import { fromDb, HttpError, type Rpc } from "./ops.ts";
import type { SmsProvider } from "./sms.ts";
import { toInternational } from "./sms.ts";
import { firstName, smsSegments } from "./text.ts";

export interface SmsDeps { rpc: Rpc; sms: SmsProvider }
export type SmsResult = "sent" | "failed" | "paused";
const PHONE = /^(07|01)\d{8}$/;

async function charge(d: SmsDeps, i: { landlordId: string; template: string; phone: string; text: string; tenancyId?: string | null }) {
  const segments = smsSegments(i.text);
  const r = await d.rpc("sms_charge", { p_landlord: i.landlordId, p_template: i.template, p_recipient: i.phone, p_body: i.text, p_segments: segments, p_tenancy: i.tenancyId ?? null });
  if (r.error) throw fromDb(r.error);
  const id = r.data as string;
  const s = await d.rpc("sms_message_status", { p_message: id });
  return { id, segments, paused: s.data === "paused_insufficient_balance" };
}

async function deliver(d: SmsDeps, c: { id: string; segments: number }, phone: string, text: string): Promise<"sent" | "failed"> {
  try {
    const sent = await d.sms.send(toInternational(phone), text);
    await d.rpc("sms_mark_status", { p_message: c.id, p_status: "sent", p_provider_id: sent.id || null });
    await d.rpc("celcom_record_usage", { p_segments: c.segments, p_purpose: "landlord_sms" }).then(undefined, () => {});
    return "sent";
  } catch (e) {
    console.error("sms failed", e instanceof Error ? e.message : e);
    await d.rpc("sms_provider_failed", { p_message: c.id });              // the landlord gets the money back
    return "failed";
  }
}

/** One message from a landlord's wallet. At zero balance it fails and costs nothing. */
export async function sendLandlordSms(d: SmsDeps, i: { landlordId: string; template: string; phone: string; text: string; tenancyId?: string | null }): Promise<SmsResult> {
  const c = await charge(d, i);
  if (c.paused) return "paused";
  return deliver(d, c, i.phone, i.text);
}

/** "Payment received" text. It must never get in the way of recording the payment, and at zero balance it simply fails. */
export async function notifyPaid(d: SmsDeps, ledgerId: string) {
  try {
    const r = await d.rpc("ledger_notice", { p_ledger: ledgerId });
    const n = r.data as { landlord_id: string; tenancy_id: string; phone: string; name: string; amount: number; receipt: string; balance: number } | null;
    if (!n) return;
    const text = `Hello ${firstName(n.name)}, we received KES ${n.amount} for your rent. Receipt ${n.receipt}.${n.balance > 0 ? ` Balance KES ${n.balance}.` : " You are paid up."}`;
    await sendLandlordSms(d, { landlordId: n.landlord_id, template: "payment_confirmed", phone: n.phone, text, tenancyId: n.tenancy_id });
  } catch (e) { console.error("payment text failed", e instanceof Error ? e.message : e); }
}

export async function broadcast(d: SmsDeps, i: { landlordId: string; recipients: { tenancyId: string; phone: string }[]; message: string }) {
  const text = i.message.trim();
  if (text.length < 1 || text.length > 480) throw new HttpError(400, "Write a message of up to 480 characters");
  if (i.recipients.length === 0) throw new HttpError(400, "There is nobody to send this to");
  if (i.recipients.length > 100) throw new HttpError(400, "Send to at most 100 people at a time");
  const queued: { id: string; segments: number; phone: string }[] = [];
  let skipped = 0;
  for (const [n, r] of i.recipients.entries()) {              // charge one by one, and stop the moment the wallet runs out
    const c = await charge(d, { landlordId: i.landlordId, template: "broadcast", phone: r.phone, text, tenancyId: r.tenancyId });
    if (c.paused) { skipped = i.recipients.length - n; break; }
    queued.push({ id: c.id, segments: c.segments, phone: r.phone });
  }
  let sent = 0, failed = 0;
  for (let k = 0; k < queued.length; k += 10) {
    const results = await Promise.all(queued.slice(k, k + 10).map((q) => deliver(d, q, q.phone, text)));
    for (const r of results) r === "sent" ? sent++ : failed++;
  }
  return { sent, failed, skipped, paused: skipped > 0 };
}

const WHEN: Record<string, string> = { "7d": "in 7 days", "4d": "in 4 days", "2d": "in 2 days", "1d": "tomorrow", due: "today" };
export function reminderSms(name: string, balance: number, trigger: string) {
  const n = firstName(name);
  return trigger === "overdue"
    ? `Hello ${n}, your rent of KES ${balance} is overdue. Please pay in the Rental Houses app.`
    : `Hello ${n}, your rent of KES ${balance} is due ${WHEN[trigger] ?? "soon"}. Pay in the Rental Houses app.`;
}

export async function runReminders(d: SmsDeps, isoDate: string) {
  const r = await d.rpc("due_reminders", { p_date: isoDate });
  if (r.error) throw fromDb(r.error);
  const out = { sent: 0, failed: 0, paused: 0 };
  for (const x of ((r.data as { tenancy_id: string; landlord_id: string; phone: string; tenant_name: string; balance: number; trigger: string }[] | null) ?? []).slice(0, 2000)) {
    const res = await sendLandlordSms(d, { landlordId: x.landlord_id, template: x.trigger === "overdue" ? "arrears" : "rent_reminder", phone: x.phone, text: reminderSms(x.tenant_name, x.balance, x.trigger), tenancyId: x.tenancy_id });
    if (res === "sent") { out.sent++; await d.rpc("mark_reminder_sent", { p_tenancy: x.tenancy_id, p_date: isoDate, p_trigger: x.trigger }); }
    else if (res === "failed") out.failed++; else out.paused++;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function submitVisitRequest(d: { rpc: Rpc; ipHash: string }, b: Record<string, unknown>) {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (typeof b.houseId !== "string" || !UUID.test(b.houseId)) throw new HttpError(400, "Choose a house");
  if (name.length < 2 || name.length > 120) throw new HttpError(400, "Enter your name");
  if (typeof b.phone !== "string" || !PHONE.test(b.phone)) throw new HttpError(400, "Enter a valid Kenyan phone number");
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new HttpError(400, "Pick a date");
  if (!["Morning", "Afternoon", "Evening"].includes(String(b.window))) throw new HttpError(400, "Pick a time of day");
  const r = await d.rpc("create_public_visit_request", { p_house: b.houseId, p_name: name, p_phone: b.phone, p_date: b.date, p_window: b.window, p_ip_hash: d.ipHash });
  if (r.error) throw fromDb(r.error);
  return { ok: true };
}
