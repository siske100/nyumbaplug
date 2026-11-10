// Inviting tenants and accepting an invite.
import { fromDb, HttpError, type Rpc } from "./ops.ts";
import { hmacHex, randomToken } from "./text.ts";

export interface InviteDeps { rpc: Rpc; appOrigin: string; pepper: string }

export async function createInvite(d: InviteDeps, i: { landlordId: string; kind: unknown; tenancyId?: unknown }) {
  if (i.kind !== "tenant") throw new HttpError(400, "Choose tenant");
  const token = randomToken();
  const hash = await hmacHex(token, d.pepper);
  const made = await d.rpc("create_invite", {
    p_landlord: i.landlordId, p_kind: i.kind, p_tenancy: i.tenancyId ?? null, p_hash: hash,
  });
  if (made.error) throw fromDb(made.error);
  const link = `${d.appOrigin}/invite/${token}`;
  return { link, expiresAt: made.data };
}

const mask = (p: string) => `${p.slice(0, 4)} ••• ${p.slice(-3)}`;

export async function lookupInvite(d: { rpc: Rpc; pepper: string }, token: unknown) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) throw new HttpError(404, "This invite link is not valid or has expired");
  const r = await d.rpc("invite_lookup", { p_hash: await hmacHex(token, d.pepper) });
  const info = r.data as { kind: string; landlord_name: string | null; invitee_name: string | null; invitee_phone: string; house_title: string; unit_label: string | null } | null;
  if (r.error || !info) throw new HttpError(404, "This invite link is not valid or has expired");
  return { kind: info.kind, landlordName: info.landlord_name, inviteeName: info.invitee_name, houseTitle: info.house_title, unit: info.unit_label, phoneHint: mask(info.invitee_phone) };
}

export interface AcceptDeps { rpc: Rpc; pepper: string; createUser(email: string, password: string, kind: string): Promise<string>; deleteUser(id: string): Promise<void> }

export async function acceptInvite(d: AcceptDeps, b: Record<string, unknown>) {
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, "Enter a valid email address");
  if (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new HttpError(400, "Use at least 10 characters, with letters and numbers");
  const info = await lookupInvite(d, b.token);
  const hash = await hmacHex(b.token as string, d.pepper);
  let userId: string;
  try { userId = await d.createUser(email, password, info.kind); }
  catch { throw new HttpError(409, "We could not create an account with that email. If you already have one, sign in instead."); }
  const r = await d.rpc("invite_accept", { p_hash: hash, p_user: userId });
  if (r.error) { await d.deleteUser(userId).catch(() => {}); throw fromDb(r.error); }       // no half-made accounts
  return { ok: true, kind: info.kind };
}
