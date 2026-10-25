import { handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { connectDaraja } from "../_shared/payments.ts";
import { payDeps } from "../_shared/wiring.ts";

// A landlord connects their own Paybill. Only an active landlord can, and the secrets are never returned.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const { data: p } = await userClient(req).from("profiles").select("role, landlord_state").single();
  if (p?.role !== "landlord" || p.landlord_state !== "active") throw new HttpError(403, "Your account must be active to connect a Paybill");
  return connectDaraja(payDeps(), user.id, await readJson(req));
}));
