import { adminClient, handle, HttpError, readJson } from "../_shared/http.ts";
import { acceptInvite, acceptInviteForUser } from "../_shared/invites.ts";
import { pepper } from "../_shared/wiring.ts";

Deno.serve(handle(async (req) => {
  const admin = adminClient();
  const authToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const auth = authToken ? (await admin.auth.getUser(authToken)).data.user : null;
  const b = await readJson(req);
  if (auth) return acceptInviteForUser({ rpc: (fn, args) => admin.rpc(fn, args), pepper: pepper("invite") }, b.token, auth.id);
  if (typeof b.email !== "string" || typeof b.password !== "string") {
    throw new HttpError(401, "Sign in to link this tenancy");
  }
  return acceptInvite({
    rpc: (fn, args) => admin.rpc(fn, args), pepper: pepper("invite"),
    createUser: async (email, password, kind) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { invited_role: kind } });
      if (error || !data.user) throw new Error("create failed");
      return data.user.id;
    },
    deleteUser: async (id) => { await admin.auth.admin.deleteUser(id); },
  }, b);
}));
