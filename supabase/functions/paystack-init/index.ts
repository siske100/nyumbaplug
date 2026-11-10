import { handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { platformBuyer } from "../_shared/buyer.ts";
import { fromDb } from "../_shared/ops.ts";
import { startPlatformCheckout, startRentCheckout } from "../_shared/paystack.ts";
import { paystackDeps } from "../_shared/wiring.ts";

// Opens a Paystack checkout (card or M-Pesa) and returns its address; the browser then goes there.
//   { kind: "rent" }                                  a tenant pays rent; HousePlug Kenya collects it and holds it for the landlord
//   { kind: "platform", purpose, amount, referenceId? }  a landlord pays HousePlug Kenya (subscription, SMS credit)
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  if (!user.email) throw new HttpError(400, "Your account needs an email address to pay by card");
  const d = paystackDeps();

  if (body.kind === "rent") {
    const me = userClient(req);
    const { data: route, error } = await me.rpc("tenant_payment_route");
    if (error) throw fromDb(error);
    if (route !== "platform") throw new HttpError(409, "Your landlord collects rent another way. Please follow the instructions on your rent page.");
    const { data: t } = await me.from("tenancies").select("id, tenancy_code").neq("status", "ended").order("status").limit(1).maybeSingle();
    if (!t) throw new HttpError(404, "We could not find your tenancy");
    const { data: p } = await me.from("profiles").select("phone, phone_verified").single();
    if (!p?.phone || !p.phone_verified) throw new HttpError(400, "Confirm your phone number first");
    return startRentCheckout(d, { tenancyId: t.id, tenancyCode: t.tenancy_code, email: user.email, phone: p.phone });
  }
  if (body.kind === "platform") {
    const purpose = String(body.purpose);
    const { phone } = await platformBuyer(req, purpose);
    return startPlatformCheckout(d, {
      payerId: user.id, purpose, amount: Number(body.amount), email: user.email, phone,
      referenceId: typeof body.referenceId === "string" ? body.referenceId : undefined,
    });
  }
  throw new HttpError(400, "Invalid payment request");
}));
