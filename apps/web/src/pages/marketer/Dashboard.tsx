import { useState } from "react";
import { Building2, CalendarDays, LayoutDashboard } from "lucide-react";
import { api } from "@/api";
import type { MarketplaceListingInput } from "@/api/types";
import { AppShell, type NavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { HOUSE_TYPES } from "@/data/counties";
import { useSession } from "@/features/auth/useSession";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

const blankListing: MarketplaceListingInput = {
  id: null, title: "", description: "", countyId: 0, townId: 0,
  type: "Bedsitter", rent: 0, viewingFee: 200, active: true,
};

const marketerNav: NavItem[] = [
  { to: "/marketer", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/marketer#listings", label: "My listings", icon: Building2 },
  { to: "/marketer#bookings", label: "Bookings", icon: CalendarDays },
];

function bookingStatus(status: string) {
  if (status === "awaiting_payment") return "Waiting for payment";
  if (status === "paid") return "Paid; awaiting viewing";
  if (status === "viewed") return "Client confirmed viewed";
  if (status === "paid_out") return "Paid at month end";
  return "Refunded to client";
}

export default function MarketerDashboard() {
  const { data: session } = useSession();
  const dashboard = useLive("marketer", "marketplace-dashboard", () => api.marketplace.marketerDashboard(), {
    refetchInterval: 8000,
  });
  const places = useLive("marketer", "marketplace-places", () => api.landlord.places());
  const activate = useLiveMutation("marketer", () => api.marketplace.payActivation());
  const save = useLiveMutation("marketer", (input: MarketplaceListingInput) => api.marketplace.saveListing(input));
  const [form, setForm] = useState<MarketplaceListingInput | null>(null);
  const [problem, setProblem] = useState<string>();
  const d = dashboard.data;

  const submitListing = () => {
    if (!form) return;
    if (form.title.trim().length < 5 || form.description.trim().length < 20 || !form.countyId || !form.townId || form.rent < 1 || form.viewingFee < 20) {
      setProblem("Complete every field. Description must be at least 20 characters and the viewing fee at least KES 20.");
      return;
    }
    setProblem(undefined);
    save.mutate(form, { onSuccess: () => setForm(null) });
  };
  const filteredTowns = places.data?.towns.filter((town) => town.countyId === form?.countyId) ?? [];

  return <AppShell items={marketerNav}>
    <div className="grid gap-4">
      <PageHead title={`Marketer dashboard${session?.name ? ` · ${session.name.split(" ")[0]}` : ""}`}
        sub="Post houses, manage paid viewing bookings, and track client confirmations for month-end settlement." />
      <ErrorNote error={dashboard.error ?? places.error} />
      {!d?.active ? (
        <Panel tone="hero" className="grid gap-4 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl">Activate your marketer account</h2><Chip>{d?.activationStatus === "pending" ? "Payment pending" : "Not activated"}</Chip></div>
          <p className="text-graphite-300">Pay the one-time KES 699 registration fee to the platform Paybill. You can post houses after Safaricom confirms the payment.</p>
          <p className="text-sm text-graphite-400">The M-Pesa prompt is sent to your verified phone{session?.phone ? ` (${session.phone})` : ""}.</p>
          {d?.activationStatus === "failed" && <p className="text-sm text-danger">The last activation payment did not complete. You can try again.</p>}
          <ErrorNote error={activate.error} />
          <div><Button loading={activate.isPending} disabled={d?.activationStatus === "pending"} onClick={() => activate.mutate()}>Pay KES 699 registration fee</Button></div>
        </Panel>
      ) : (
        <>
          <Panel className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div><p className="font-medium">Account active</p><p className="text-sm text-graphite-300">Monthly settlements go to your verified phone {session?.phone}. Only client-confirmed viewings are payable, less the 5% platform fee.</p></div>
            <Chip tone="ok">Activated {d.activatedAt ? fmtDate(d.activatedAt) : ""}</Chip>
          </Panel>
          <Panel id="listings" className="grid gap-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl">{form?.id ? "Edit house listing" : "Your houses"}</h2><Button variant="glass" size="sm" onClick={() => setForm(form ? null : { ...blankListing })}>{form ? "Close form" : "Post a house"}</Button></div>
            {form && (
              <div className="grid gap-3 rounded-xl border border-white/10 bg-white/3 p-4">
                <Field label="Listing title" maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <label className="grid gap-1.5 text-sm text-graphite-200">House description
                  <textarea rows={4} maxLength={3000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 text-bone placeholder:text-graphite-400 focus:border-ember-400/70 focus:outline-none" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField label="County" value={form.countyId || ""} onChange={(e) => setForm({ ...form, countyId: Number(e.target.value), townId: 0 })}>
                    <option value="">Choose county</option>{places.data?.counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SelectField>
                  <SelectField label="Town" value={form.townId || ""} onChange={(e) => setForm({ ...form, townId: Number(e.target.value) })}>
                    <option value="">Choose town</option>{filteredTowns.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </SelectField>
                  <SelectField label="House type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MarketplaceListingInput["type"] })}>
                    {HOUSE_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </SelectField>
                  {form.id && <SelectField label="Listing visibility" value={form.active ? "active" : "hidden"} onChange={(e) => setForm({ ...form, active: e.target.value === "active" })}>
                    <option value="active">Published</option><option value="hidden">Hidden</option>
                  </SelectField>}
                  <Field label="Monthly rent (KES)" type="number" min={1} value={form.rent || ""} onChange={(e) => setForm({ ...form, rent: Number(e.target.value) })} />
                  <Field label="Your viewing fee (KES)" type="number" min={20} max={20000} value={form.viewingFee || ""} onChange={(e) => setForm({ ...form, viewingFee: Number(e.target.value) })} hint="The client pays this once when booking." />
                </div>
                {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
                <ErrorNote error={save.error} />
                <div className="flex gap-2"><Button loading={save.isPending} onClick={submitListing}>{form.id ? "Save changes" : "Publish house"}</Button><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button></div>
              </div>
            )}
            {d.listings.length === 0 && !form && <p className="text-sm text-graphite-300">You have not posted a house yet.</p>}
            <ul className="grid gap-2">
              {d.listings.map((item) => {
                const place = places.data?.towns.find((t) => t.id === item.townId)?.name ?? "";
                const county = places.data?.counties.find((c) => c.id === item.countyId)?.name ?? "";
                return <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/3 p-3">
                  <div><p className="font-medium">{item.title}</p><p className="text-sm text-graphite-300">{place}, {county} · {formatKes(item.viewingFee)} viewing fee · {item.active ? "Published" : "Hidden"}</p></div>
                  <Button size="sm" variant="glass" onClick={() => { setProblem(undefined); setForm({ ...item }); }}>Edit</Button>
                </li>;
              })}
            </ul>
          </Panel>
          <Panel id="bookings" className="grid gap-3 p-5 sm:p-6">
            <h2 className="text-xl">Viewing bookings</h2>
            <p className="text-sm text-graphite-300">A paid booking is not payable until the client confirms the in-person viewing. Client confirmation is the only basis for settlement.</p>
            {d.bookings.length === 0 && <p className="text-sm text-graphite-300">No paid viewing bookings yet.</p>}
            {d.bookings.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/3 p-3">
                <div><p className="font-medium">{b.listingTitle} · {formatKes(b.amount)}</p><p className="text-sm text-graphite-300">{b.clientName} · {b.phone} · {b.date} {b.timeWindow}</p><p className="text-xs text-graphite-400">Client confirmation determines settlement eligibility; otherwise refund is due.</p></div>
                <Chip tone={b.status === "viewed" || b.status === "paid_out" ? "ok" : "neutral"}>{bookingStatus(b.status)}</Chip>
              </div>
            ))}
          </Panel>
        </>
      )}
    </div>
  </AppShell>;
}
