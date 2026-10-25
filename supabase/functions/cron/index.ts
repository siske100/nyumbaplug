import { handle, HttpError, readJson } from "../_shared/http.ts";
import { runCron } from "../_shared/cron.ts";
import { safeEqual } from "../_shared/text.ts";
import { makeRpc, payDeps, smsDeps } from "../_shared/wiring.ts";

// Scheduled jobs. Called by the database scheduler with a shared secret, never by a browser.
Deno.serve(handle(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) throw new HttpError(403, "Not allowed");
  const rpc = makeRpc();
  return runCron((await readJson(req)).task, { rpc, pay: payDeps(rpc), sms: smsDeps(rpc) });
}));
