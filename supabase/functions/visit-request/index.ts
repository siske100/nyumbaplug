import { handle, readJson } from "../_shared/http.ts";
import { submitVisitRequest } from "../_shared/messaging.ts";
import { makeRpc, pepper } from "../_shared/wiring.ts";

// Public. Creates the viewing request only when the phone code is right.
Deno.serve(handle(async (req) => submitVisitRequest({ rpc: makeRpc(), pepper: pepper("visitor") }, await readJson(req))));
