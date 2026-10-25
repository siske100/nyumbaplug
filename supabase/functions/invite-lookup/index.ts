import { handle, readJson } from "../_shared/http.ts";
import { lookupInvite } from "../_shared/invites.ts";
import { makeRpc, pepper } from "../_shared/wiring.ts";

Deno.serve(handle(async (req) => lookupInvite({ rpc: makeRpc(), pepper: pepper("invite") }, (await readJson(req)).token)));
