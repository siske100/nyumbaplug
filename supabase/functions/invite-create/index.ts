import { handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { createInvite } from "../_shared/invites.ts";
import { mustEnv } from "../_shared/http.ts";
import { makeRpc, pepper, smsDeps } from "../_shared/wiring.ts";

// The link is shown to the landlord too, so it can be shared on WhatsApp if the SMS cannot be sent.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const { data: p } = await userClient(req).from("profiles").select("role").single();
  if (p?.role !== "landlord") throw new HttpError(403, "Not allowed");
  const b = await readJson(req);
  const rpc = makeRpc();
  return createInvite({ ...smsDeps(rpc), appOrigin: mustEnv("APP_ORIGIN"), pepper: pepper("invite") }, { landlordId: user.id, kind: b.kind, tenancyId: b.tenancyId });
}));
