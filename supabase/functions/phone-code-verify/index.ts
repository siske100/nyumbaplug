import { adminClient, handle, mustEnv, readJson, requireUser } from "../_shared/http.ts";
import { verifyPhoneCode } from "../_shared/ops.ts";

Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const admin = adminClient();
  return verifyPhoneCode(user.id, await readJson(req), { rpc: (fn, args) => admin.rpc(fn, args), pepper: mustEnv("CODE_PEPPER") });
}));
