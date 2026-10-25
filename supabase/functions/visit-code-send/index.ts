import { handle, readJson } from "../_shared/http.ts";
import { sendVisitorCode } from "../_shared/messaging.ts";
import { clientIp, hmacHex } from "../_shared/text.ts";
import { pepper, smsDeps } from "../_shared/wiring.ts";

// Public. A visitor asks for a code before requesting a viewing. Limits per phone and per network address live in the database.
Deno.serve(handle(async (req) => {
  const { phone } = await readJson(req);
  return sendVisitorCode(smsDeps(), { phone, ipHash: await hmacHex(clientIp(req.headers), pepper("ip")), pepper: pepper("visitor") });
}));
