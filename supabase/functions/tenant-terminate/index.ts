import { adminClient, handle, HttpError, readJson, requireUser, userClient } from "../_shared/http.ts";
import { terminateTenantAccount } from "../_shared/tenant-account.ts";

Deno.serve(handle(async (req) => {
  await requireUser(req);
  const body = await readJson(req);
  if (typeof body.tenancyId !== "string") throw new HttpError(400, "Choose a tenancy");
  const admin = adminClient();
  return terminateTenantAccount({
    rpc: (fn, args) => userClient(req).rpc(fn, args),
    deleteUser: async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id);
      return { error };
    },
  }, body.tenancyId);
}));
