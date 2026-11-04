import { handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { platformPay } from "../_shared/payments.ts";
import { payDeps } from "../_shared/wiring.ts";

// The account must use a verified email and saved phone; the database validates each purchase purpose.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const purpose = String(body.purpose);
  const { data: p } = await userClient(req).from("profiles").select("phone, phone_verified, email_verified, role").single();
  const expectedRole = purpose === "marketer_activation" ? "marketer"
    : purpose === "viewing_fee" ? "client" : "landlord";
  if (p?.role !== expectedRole) throw new HttpError(403, "Not allowed");
  if (!p.phone || !p.email_verified) throw new HttpError(400, "Confirm your email and add your phone number first");
  if ((purpose === "marketer_activation" || purpose === "viewing_fee") && !p.phone_verified) {
    throw new HttpError(400, "Verify your phone number before continuing");
  }
  return platformPay(payDeps(), {
    landlordId: user.id, purpose, amount: Number(body.amount), phone: p.phone,
    referenceId: typeof body.referenceId === "string" ? body.referenceId : undefined,
  });
}));
