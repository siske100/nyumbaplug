// Pure helpers for phone codes. No network, no secrets of their own, so they are fully unit tested.

/** A uniformly random six-digit code. Rejection sampling avoids the small bias of a plain modulo. */
export function generateCode(random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  for (;;) {
    const v = random(1)[0] as number;
    if (v < limit) return String(v % 1_000_000).padStart(6, "0");
  }
}

/** Keyed hash of the code. The database stores only this, never the code itself. */
export async function hashCode(code: string, userId: string, pepper: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${userId}:${code}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isSixDigits = (v: unknown): v is string => typeof v === "string" && /^\d{6}$/.test(v);

/** One SMS segment (under 160 characters) so each code costs a single segment. */
export const smsText = (code: string) => `Your Rental Houses code is ${code}. It expires in 5 minutes. Do not share it.`;
