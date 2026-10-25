import { handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { platformPay } from "../_shared/payments.ts";
import { payDeps } from "../_shared/wiring.ts";

// A landlord pays their subscription or buys SMS credit. Email is verified; the prompt uses their saved phone.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const { data: p } = await userClient(req).from("profiles").select("phone, email_verified, role").single();
  if (p?.role !== "landlord") throw new HttpError(403, "Not allowed");
  if (!p.phone || !p.email_verified) throw new HttpError(400, "Confirm your email and add your phone number first");
  return platformPay(payDeps(), { landlordId: user.id, purpose: String(body.purpose), amount: Number(body.amount), phone: p.phone });
}));
