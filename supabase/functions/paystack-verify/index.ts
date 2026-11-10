import { handle, HttpError, readJson, requireUser } from "../_shared/http.ts";
import { checkPayment } from "../_shared/paystack.ts";
import { paystackDeps } from "../_shared/wiring.ts";

// Where the payer lands after Paystack. Nothing in the address is trusted: Paystack is asked directly, then the payment is credited once.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const reference = (await readJson(req)).reference;
  if (typeof reference !== "string" || reference.length > 80) throw new HttpError(400, "Invalid payment reference");
  return checkPayment(paystackDeps(), user.id, reference);
}));
