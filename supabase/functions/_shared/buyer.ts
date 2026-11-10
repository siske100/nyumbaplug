import { HttpError, userClient } from "./http.ts";

/** Who may buy what from HousePlug Kenya. Shared by every way of paying so the rules cannot drift apart. */
export async function platformBuyer(req: Request, purpose: string) {
  const { data: p } = await userClient(req).from("profiles").select("phone, phone_verified, email_verified, role").single();
  const expectedRole = purpose === "marketer_activation" ? "marketer" : purpose === "viewing_fee" ? "client" : "landlord";
  if (p?.role !== expectedRole) throw new HttpError(403, "Not allowed");
  if (!p.phone || !p.email_verified) throw new HttpError(400, "Confirm your email and add your phone number first");
  if ((purpose === "marketer_activation" || purpose === "viewing_fee") && !p.phone_verified) {
    throw new HttpError(400, "Verify your phone number before continuing");
  }
  return { phone: p.phone as string };
}
