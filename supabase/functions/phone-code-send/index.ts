import { adminClient, handle, mustEnv, requireUser } from "../_shared/http.ts";
import { sendPhoneCode } from "../_shared/ops.ts";
import { providerFromEnv } from "../_shared/sms.ts";

// Sends a phone verification code. The platform pays for this SMS, not the landlord.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const admin = adminClient();
  return sendPhoneCode(user.id, {
    rpc: (fn, args) => admin.rpc(fn, args),
    phoneOf: async (id) => (await admin.from("profiles").select("phone").eq("id", id).single()).data?.phone ?? null,
    sms: providerFromEnv((k) => Deno.env.get(k)),
    pepper: mustEnv("CODE_PEPPER"),
  });
}));
