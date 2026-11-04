import { handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { fromDb } from "../_shared/ops.ts";
import { bankTestPay, tenantPay } from "../_shared/payments.ts";
import { payDeps } from "../_shared/wiring.ts";

// A tenant taps "Pay rent". Their own tenancy is found by the database's row-level rules, and only their verified phone is used.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  if (body.action === "bank_test") return bankTestPay(payDeps(), user.id);
  if (body.action !== undefined) throw new HttpError(400, "Invalid payment action");
  const me = userClient(req);
  const { data: route, error: routeError } = await me.rpc("tenant_payment_route");
  if (routeError) throw fromDb(routeError);
  if (route !== "own") throw new HttpError(409, "Your landlord has not enabled a verified direct rent payment method. Please contact your landlord.");
  const { data: t } = await me.from("tenancies").select("id, landlord_id, tenancy_code").eq("status", "active").limit(1).maybeSingle();
  if (!t) throw new HttpError(404, "We could not find your tenancy");
  const { data: p } = await me.from("profiles").select("phone, phone_verified").single();
  if (!p?.phone || !p.phone_verified) throw new HttpError(400, "Confirm your phone number first");
  return tenantPay(payDeps(), { tenancyId: t.id, landlordId: t.landlord_id, tenancyCode: t.tenancy_code, phone: p.phone, paymentMode: route });
}));
