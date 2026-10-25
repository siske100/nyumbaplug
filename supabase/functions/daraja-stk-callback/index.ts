import { handle } from "../_shared/http.ts";
import { handleStkCallback } from "../_shared/payments.ts";
import { payDeps } from "../_shared/wiring.ts";

// Safaricom reports the result of an M-Pesa prompt. The secret in the address, the matching request and a direct check with Safaricom all have to agree.
Deno.serve(handle(async (req) => {
  const token = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return handleStkCallback(payDeps(), token, await req.json().catch(() => null));
}));
