import { handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { broadcast } from "../_shared/messaging.ts";
import { smsDeps } from "../_shared/wiring.ts";

// A landlord texts one tenant, one house or everyone. Recipients are read under the landlord's own session,
// so the database guarantees they can only ever reach their own tenants.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const b = await readJson(req);
  let q = userClient(req).from("tenancies").select("id, tenant_phone").in("status", ["active", "notice"]);
  if (b.scope === "tenancy" && typeof b.targetId === "string") q = q.eq("id", b.targetId);
  else if (b.scope === "house" && typeof b.targetId === "string") q = q.eq("house_id", b.targetId);
  else if (b.scope !== "all") throw new HttpError(400, "Choose who to send to");
  const { data, error } = await q.limit(101);
  if (error) throw new HttpError(500, "Something went wrong. Please try again.");
  return broadcast(smsDeps(), { landlordId: user.id, recipients: (data ?? []).map((t) => ({ tenancyId: t.id, phone: t.tenant_phone })), message: String(b.message ?? "") });
}));
