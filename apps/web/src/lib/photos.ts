import { ApiError } from "./queryClient";

const MAX_SIDE = 1600;

/**
 * Re-draws a photo onto a clean canvas and saves it again as a JPEG. This does two things at once:
 * it drops all hidden data (including GPS location, which would give away the exact place) and it shrinks the file for mobile data.
 * If the browser cannot do it, the photo is refused. An unprepared photo is never uploaded.
 */
export async function cleanPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob) throw new Error("no blob");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    throw new ApiError(422, `${file.name}: we could not prepare this photo. Try a different one.`);
  }
}
