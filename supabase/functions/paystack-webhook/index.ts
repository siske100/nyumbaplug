import { handle, HttpError } from "../_shared/http.ts";
import { handlePaystackWebhook } from "../_shared/paystack.ts";
import { paystackDeps } from "../_shared/wiring.ts";

// Paystack calls this after a payment. The secret in the address picks whose key signs it; the signature and a direct check with Paystack must both agree.
Deno.serve(handle(async (req) => {
  const token = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!token || token === "paystack-webhook") throw new HttpError(403, "Not allowed");
  return handlePaystackWebhook(paystackDeps(), token, await req.text(), req.headers.get("x-paystack-signature"));
}));
