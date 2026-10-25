import { HttpError, type Rpc } from "./ops.ts";
import { reconcilePending, type PayDeps } from "./payments.ts";
import { runReminders, type SmsDeps } from "./messaging.ts";

/** Scheduled jobs. Each one is safe to run twice. */
export async function runCron(task: unknown, d: { rpc: Rpc; pay: PayDeps; sms: SmsDeps; now?: Date }) {
  const nairobi = new Date((d.now ?? new Date()).getTime() + 3 * 3600_000);          // days and months follow Nairobi time
  const iso = nairobi.toISOString().slice(0, 10);
  switch (task) {
    case "generate-charges": { const r = await d.rpc("generate_charges", { p_year: nairobi.getUTCFullYear(), p_month: nairobi.getUTCMonth() + 1 }); return { created: r.data }; }
    case "expire-subscriptions": return { expired: (await d.rpc("expire_subscriptions", {})).data };
    case "reminders": return runReminders(d.sms, iso);
    case "reconcile": return reconcilePending(d.pay);
    case "payouts": return { payouts: (await d.rpc("create_due_payouts", {})).data };
    default: throw new HttpError(400, "Unknown task");
  }
}
