import { handle, HttpError } from "../_shared/http.ts";

// Retained temporarily so old clients get an explicit response instead of sending obsolete OTP SMS.
Deno.serve(handle(async () => { throw new HttpError(410, "Viewing requests no longer require a phone code"); }));
