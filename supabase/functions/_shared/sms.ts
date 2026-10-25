// SMS sending behind one small interface, so the provider can change without touching the rest.

export interface SmsProvider { send(to: string, text: string): Promise<{ id: string }> }

/** 0712345678 becomes 254712345678. Anything else is refused. */
export function toInternational(local: string): string {
  if (!/^(07|01)\d{8}$/.test(local)) throw new Error("Invalid phone number");
  return "254" + local.slice(1);
}

/** Prints the message instead of sending it. Refuses to run unless SMS_PROVIDER is set to console on purpose. */
export function consoleProvider(): SmsProvider {
  return { async send(to, text) { console.log(`[sms:console] to=${to} text=${text}`); return { id: "console" }; } };
}

/**
 * Celcom Africa. CONFIRM THE URL AND FIELD NAMES AGAINST CELCOM'S CURRENT API DOCUMENTATION BEFORE GOING LIVE.
 * This is the only place that knows the request format. Settings come from environment variables.
 */
export function celcomProvider(get: (k: string) => string | undefined): SmsProvider {
  const need = (k: string) => { const v = get(k); if (!v) throw new Error(`Missing setting ${k}`); return v; };
  return {
    async send(to, text) {
      const res = await fetch(need("CELCOM_API_URL"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerID: need("CELCOM_PARTNER_ID"), apikey: need("CELCOM_API_KEY"), shortcode: need("CELCOM_SHORTCODE"), mobile: to, message: text, pass_type: "plain" }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => null);
      const code = body?.responses?.[0]?.["response-code"];
      if (!res.ok || (code !== undefined && Number(code) !== 200)) throw new Error(`Celcom rejected the message (HTTP ${res.status})`);
      return { id: String(body?.responses?.[0]?.messageid ?? "") };
    },
  };
}

export function providerFromEnv(get: (k: string) => string | undefined): SmsProvider {
  const which = get("SMS_PROVIDER") ?? "celcom";
  if (which === "console") return consoleProvider();
  if (which === "celcom") return celcomProvider(get);
  throw new Error("Unknown SMS_PROVIDER");
}
