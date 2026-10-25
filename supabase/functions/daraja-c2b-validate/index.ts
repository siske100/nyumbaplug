import { handle } from "../_shared/http.ts";
import { c2bValidate } from "../_shared/payments.ts";
import { payDeps } from "../_shared/wiring.ts";

Deno.serve(handle(async (req) => c2bValidate(payDeps(), new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "", await req.json().catch(() => null))));
