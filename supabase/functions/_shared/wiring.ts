// Builds the real dependencies from environment settings. Kept apart so the logic can be tested with stand-ins.
import { createDaraja } from "./daraja.ts";
import { adminClient, mustEnv } from "./http.ts";
import { notifyPaid, type SmsDeps } from "./messaging.ts";
import type { Rpc } from "./ops.ts";
import type { ConnectDeps, PayEnv, Secrets } from "./payments.ts";
import { providerFromEnv } from "./sms.ts";
import { decryptJson, encryptJson, fromPgBytea, toPgBytea } from "./vault.ts";

const get = (k: string) => Deno.env.get(k);
export const pepper = (purpose: string) => `${mustEnv("CODE_PEPPER")}:${purpose}`;       // one secret, kept separate for codes, addresses and invites

export function makeRpc(): Rpc { const admin = adminClient(); return (fn, args) => admin.rpc(fn, args); }
export const smsDeps = (rpc: Rpc = makeRpc()): SmsDeps => ({ rpc, sms: providerFromEnv(get) });

export function payEnv(): PayEnv {
  return {
    platform: { consumerKey: mustEnv("PLATFORM_DARAJA_CONSUMER_KEY"), consumerSecret: mustEnv("PLATFORM_DARAJA_CONSUMER_SECRET"), shortcode: mustEnv("PLATFORM_DARAJA_SHORTCODE"), passkey: mustEnv("PLATFORM_DARAJA_PASSKEY") },
    platformToken: mustEnv("PLATFORM_CALLBACK_TOKEN"),
    functionsUrl: `${mustEnv("SUPABASE_URL")}/functions/v1`,
  };
}

export function payDeps(rpc: Rpc = makeRpc()): ConnectDeps {
  const sms = smsDeps(rpc);
  return {
    rpc, env: payEnv(), daraja: createDaraja(get("DARAJA_ENV") ?? "sandbox"),
    decrypt: (hex, landlordId) => decryptJson<Secrets>(fromPgBytea(hex), landlordId, mustEnv("CREDENTIALS_KEY")),
    encrypt: async (s, landlordId) => toPgBytea(await encryptJson(s, landlordId, mustEnv("CREDENTIALS_KEY"))),
    notifyPaid: (ledgerId) => notifyPaid(sms, ledgerId),
  };
}
