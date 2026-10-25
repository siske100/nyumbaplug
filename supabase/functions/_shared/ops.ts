// The logic of each function, separated from the web plumbing so it can be tested with simple stand-ins.
import { generateCode, hashCode, isSixDigits, smsText } from "./codes.ts";
import type { SmsProvider } from "./sms.ts";
import { toInternational } from "./sms.ts";
import { reminderText, segmentsOf } from "./reminder.ts";

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface DbError { code?: string; message: string }
export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError | null }>;

/** Messages raised on purpose by our own database functions (code P0001) are written for people. Everything else is hidden. */
export function fromDb(error: DbError): HttpError {
  if (error.code === "P0001") return new HttpError(400, error.message);
  console.error("database error", error.code, error.message);
  return new HttpError(500, "Something went wrong. Please try again.");
}

export interface SendDeps { rpc: Rpc; phoneOf(userId: string): Promise<string | null>; sms: SmsProvider; pepper: string; makeCode?: () => string }

export async function sendPhoneCode(userId: string, d: SendDeps) {
  const code = (d.makeCode ?? generateCode)();
  const hash = await hashCode(code, userId, d.pepper);
  const issued = await d.rpc("issue_phone_code", { p_user: userId, p_code_hash: hash });
  if (issued.error) throw fromDb(issued.error);

  const phone = await d.phoneOf(userId);
  try {
    if (!phone) throw new Error("no phone on file");
    await d.sms.send(toInternational(phone), smsText(code));
    await d.rpc("celcom_record_usage", { p_segments: 1, p_purpose: "otp" }).then(undefined, () => {});   // bookkeeping must never block a sign-in
  } catch (e) {
    console.error("sms failed", e instanceof Error ? e.message : e);
    await d.rpc("cancel_phone_code", { p_user: userId });          // never leave a person waiting for a code that was not sent
    throw new HttpError(502, "We could not send the SMS. Please try again.");
  }
  return { expiresAt: issued.data };
}

export async function verifyPhoneCode(userId: string, body: Record<string, unknown>, d: { rpc: Rpc; pepper: string }) {
  if (!isSixDigits(body.code)) throw new HttpError(400, "Enter the 6-digit code");
  const hash = await hashCode(body.code, userId, d.pepper);
  const r = await d.rpc("verify_phone_code", { p_user: userId, p_code_hash: hash });
  if (r.error) throw fromDb(r.error);
  return { verified: r.data === true };
}

export interface SyncDeps { rpc: Rpc; emailConfirmed(userId: string): Promise<boolean | null>; stateOf(userId: string): Promise<string | null> }

export async function syncEmailVerified(userId: string, d: SyncDeps) {
  const confirmed = await d.emailConfirmed(userId);
  if (confirmed === null) throw new HttpError(401, "Sign in to continue");
  if (!confirmed) throw new HttpError(409, "Your email is not confirmed yet");
  const r = await d.rpc("mark_contact_verified", { p_user: userId, p_kind: "email" });
  if (r.error) throw fromDb(r.error);
  return { state: await d.stateOf(userId) };
}

export interface ReminderDeps { rpc: Rpc; sms: SmsProvider }

/** The admin reminds a landlord that their subscription is due. One per landlord per day, charged to the platform's Celcom credit. */
export async function sendSubscriptionReminder(adminId: string, landlordId: string, d: ReminderDeps) {
  const claim = await d.rpc("claim_subscription_reminder", { p_admin: adminId, p_landlord: landlordId });
  if (claim.error) throw fromDb(claim.error);
  const c = claim.data as { reminder_id: string; name: string | null; phone: string; price: number; days_left: number; state: string };
  const text = reminderText({ name: c.name, price: c.price, daysLeft: c.days_left, state: c.state });
  try {
    await d.sms.send(toInternational(c.phone), text);
  } catch (e) {
    console.error("reminder sms failed", e instanceof Error ? e.message : e);
    await d.rpc("finish_subscription_reminder", { p_id: c.reminder_id, p_ok: false });     // a failed send does not use up the daily limit
    throw new HttpError(502, "We could not send the SMS. Please try again.");
  }
  await d.rpc("finish_subscription_reminder", { p_id: c.reminder_id, p_ok: true });
  await d.rpc("celcom_record_usage", { p_segments: segmentsOf(text), p_purpose: "reminder" }).then(undefined, () => {});
  return { sent: true };
}
