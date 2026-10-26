import { handle, readJson } from "../_shared/http.ts";
import { submitVisitRequest } from "../_shared/messaging.ts";
import { clientIp, hmacHex } from "../_shared/text.ts";
import { makeRpc, pepper } from "../_shared/wiring.ts";

// Public. Visitors provide contact details and a preferred time; the landlord follows up directly.
Deno.serve(handle(async (req) => submitVisitRequest({
  rpc: makeRpc(),
  ipHash: await hmacHex(clientIp(req.headers), pepper("ip")),
}, await readJson(req))));
