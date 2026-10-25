import { handle, HttpError, requireUser, userClient } from "../_shared/http.ts";
import { tenantPay } from "../_shared/payments.ts";
import { payDeps } from "../_shared/wiring.ts";

// A tenant taps "Pay rent". Their own tenancy is found by the database's row-level rules, and only their verified phone is used.
Deno.serve(handle(async (req) => {
  await requireUser(req);
  const me = userClient(req);
  const { data: t } = await me.from("tenancies").select("id, landlord_id, tenancy_code").eq("status", "active").limit(1).maybeSingle();
  if (!t) throw new HttpError(404, "We could not find your tenancy");
  const { data: p } = await me.from("profiles").select("phone, phone_verified").single();
  if (!p?.phone || !p.phone_verified) throw new HttpError(400, "Confirm your phone number first");
  return tenantPay(payDeps(), { tenancyId: t.id, landlordId: t.landlord_id, tenancyCode: t.tenancy_code, phone: p.phone });
}));
