import { handle, HttpError } from "../_shared/http.ts";
import { registerPlatformC2b } from "../_shared/payments.ts";
import { safeEqual } from "../_shared/text.ts";
import { payDeps } from "../_shared/wiring.ts";

// Run once after setting the platform Paybill: tells Safaricom where to send Paybill payments. Needs the same secret as the scheduled jobs.
Deno.serve(handle(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) throw new HttpError(403, "Not allowed");
  return registerPlatformC2b(payDeps());
}));
