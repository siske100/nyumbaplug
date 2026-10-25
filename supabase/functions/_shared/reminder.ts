// The text of the subscription reminder. Plain ASCII so it stays a single SMS segment.

const clean = (name: string | null | undefined) => {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const letters = first.replace(/[^A-Za-z'-]/g, "").slice(0, 12);
  return letters || "there";
};

export function reminderText(i: { name: string | null; price: number; daysLeft: number; state: string }): string {
  const who = clean(i.name);
  if (i.state === "expired" || i.daysLeft <= 0) {
    return `Hello ${who}, your Rental Houses subscription has expired. Call 0799326074 to reactivate and keep your houses listed.`;
  }
  const days = i.daysLeft === 1 ? "1 day" : `${i.daysLeft} days`;
  return `Hello ${who}, your Rental Houses subscription of KES ${i.price} expires in ${days}. Renew to keep your houses listed. Help: 0799326074`;
}

/** Segments the provider will bill for a plain ASCII message. */
export const segmentsOf = (text: string) => (text.length <= 160 ? 1 : Math.ceil(text.length / 153));
