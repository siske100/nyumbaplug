import { adminClient, handle, readJson } from "../_shared/http.ts";
import { acceptInvite } from "../_shared/invites.ts";
import { pepper } from "../_shared/wiring.ts";

// Public. The secret in the link is the proof. The account is created here, by the server, because only the server may choose a role.
Deno.serve(handle(async (req) => {
  const admin = adminClient();
  return acceptInvite({
    rpc: (fn, args) => admin.rpc(fn, args), pepper: pepper("invite"),
    createUser: async (email, password, kind) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { invited_role: kind } });
      if (error || !data.user) throw new Error("create failed");
      return data.user.id;
    },
    deleteUser: async (id) => { await admin.auth.admin.deleteUser(id); },
  }, await readJson(req));
}));
