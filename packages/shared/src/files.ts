// Checks for uploaded documents. The browser checks first for a friendly message; the storage bucket
// enforces the same size and type limits again, so a modified browser gains nothing.

export const KYC_MAX_BYTES = 5 * 1024 * 1024;
export type KycMime = "image/jpeg" | "image/png" | "application/pdf";
const EXT: Record<KycMime, "jpg" | "png" | "pdf"> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/** What the file really is, judged by its first bytes and not by its name or declared type. */
export function sniffMime(head: Uint8Array): KycMime | null {
  const is = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  if (is(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (is(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (is(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  return null;
}

export type FileCheck = { ok: true; mime: KycMime; ext: "jpg" | "png" | "pdf" } | { ok: false; reason: string };

export function validateKycFile(file: { size: number; type: string }, head: Uint8Array): FileCheck {
  if (file.size <= 0) return { ok: false, reason: "This file is empty" };
  if (file.size > KYC_MAX_BYTES) return { ok: false, reason: "This file is larger than 5 MB" };
  const real = sniffMime(head);
  if (!real) return { ok: false, reason: "Use a JPG, PNG or PDF file" };
  if (file.type && file.type !== real) return { ok: false, reason: "The file type does not match its contents" };
  return { ok: true, mime: real, ext: EXT[real] };
}

// ---- House photos: JPG, PNG or WebP, up to 5 MB each ----
export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";
const PHOTO_EXT: Record<PhotoMime, "jpg" | "png" | "webp"> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function sniffPhoto(head: Uint8Array): PhotoMime | null {
  const m = sniffMime(head);
  if (m === "image/jpeg" || m === "image/png") return m;
  const riff = [0x52, 0x49, 0x46, 0x46].every((b, i) => head[i] === b);           // "RIFF"
  const webp = [0x57, 0x45, 0x42, 0x50].every((b, i) => head[8 + i] === b);        // "WEBP"
  return riff && webp ? "image/webp" : null;
}

export type PhotoCheck = { ok: true; mime: PhotoMime; ext: "jpg" | "png" | "webp" } | { ok: false; reason: string };
export function validatePhoto(file: { size: number; type: string }, head: Uint8Array): PhotoCheck {
  if (file.size <= 0) return { ok: false, reason: "This photo is empty" };
  if (file.size > KYC_MAX_BYTES) return { ok: false, reason: "This photo is larger than 5 MB" };
  const real = sniffPhoto(head);
  if (!real) return { ok: false, reason: "Use a JPG, PNG or WebP photo" };
  if (file.type && file.type !== real) return { ok: false, reason: "The file type does not match its contents" };
  return { ok: true, mime: real, ext: PHOTO_EXT[real] };
}
