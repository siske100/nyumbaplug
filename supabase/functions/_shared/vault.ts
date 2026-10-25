// Encryption for landlords' Daraja credentials. AES-256-GCM, a fresh random IV every time, and the landlord's id bound in,
// so a stolen ciphertext cannot be moved to another landlord's account.

const VERSION = 1;
const enc = new TextEncoder();

async function key(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(value: unknown, landlordId: string, base64Key: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(landlordId) }, await key(base64Key), enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = VERSION; out.set(iv, 1); out.set(ct, 13);
  return out;
}

export async function decryptJson<T>(data: Uint8Array, landlordId: string, base64Key: string): Promise<T> {
  if (data[0] !== VERSION || data.length < 30) throw new Error("Unreadable credentials");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(1, 13), additionalData: enc.encode(landlordId) }, await key(base64Key), data.slice(13));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/** Postgres bytea travels as "\\x" plus hex. */
export const toPgBytea = (u: Uint8Array) => "\\x" + [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fromPgBytea = (s: string): Uint8Array => {
  const hex = s.startsWith("\\x") ? s.slice(2) : s;
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
};
