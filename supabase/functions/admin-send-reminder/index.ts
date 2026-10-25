import { adminClient, handle, readJson, requireAdmin } from "../_shared/http.ts";
import { HttpError, sendSubscriptionReminder } from "../_shared/ops.ts";
import { providerFromEnv } from "../_shared/sms.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(handle(async (req) => {
  const admin = await requireAdmin(req);
  const { landlordId } = await readJson(req);
  if (typeof landlordId !== "string" || !UUID.test(landlordId)) throw new HttpError(400, "Choose a landlord");
  const db = adminClient();
  return sendSubscriptionReminder(admin.id, landlordId, { rpc: (fn, args) => db.rpc(fn, args), sms: providerFromEnv((k) => Deno.env.get(k)) });
}));
