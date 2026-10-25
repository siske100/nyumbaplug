import { adminClient, handle, requireUser } from "../_shared/http.ts";
import { syncEmailVerified } from "../_shared/ops.ts";

// After the person enters the email code in the browser, Supabase Auth marks the email as confirmed.
// This reads that fact from Auth itself (never from the browser) and moves the account to the next step.
Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const admin = adminClient();
  return syncEmailVerified(user.id, {
    rpc: (fn, args) => admin.rpc(fn, args),
    emailConfirmed: async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      return error || !data.user ? null : Boolean(data.user.email_confirmed_at);
    },
    stateOf: async (id) => (await admin.from("profiles").select("landlord_state").eq("id", id).single()).data?.landlord_state ?? null,
  });
}));
