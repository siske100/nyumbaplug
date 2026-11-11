import { useMemo, useState } from "react";
import { ArrowRight, Building2, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Download, Eye, MessageCircle, Plus, Search, TriangleAlert, Users, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { tenantSchema } from "@rh/shared";
import type { InviteResult, TenancyRow } from "@/api/types";
import { api } from "@/api";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLandlordHouses } from "@/features/landlord/hooks";
import { useLive, useLiveMutation } from "@/features/live";
import { formatKes } from "@/lib/format";

function AddTenant({ onDone }: { onDone: () => void }) {
  const houses = useLandlordHouses();
  const add = useLiveMutation("landlord", (v: Parameters<typeof api.landlord.addTenant>[0]) => api.landlord.addTenant(v));
  const [f, setF] = useState({ houseId: "", unit: "", name: "", phone: "", emergencyName: "", emergencyPhone: "", emergencyRelationship: "", rent: "", deposit: "", dueDay: "5" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const house = houses.data?.find((h) => h.id === f.houseId);

  const submit = () => {
    const r = tenantSchema.safeParse({ name: f.name, phone: f.phone, emergencyName: f.emergencyName, emergencyPhone: f.emergencyPhone, emergencyRelationship: f.emergencyRelationship, unitLabel: f.unit });
    const e: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) e[String(i.path[0])] ??= i.message;
    if (!house) e.houseId = "Choose a house";
    else if (house.vacant < 1) e.houseId = "No vacant units in this listing";
    const rent = Number(f.rent || house?.rent), due = Number(f.dueDay);
    if (!(rent > 0)) e.rent = "Enter the monthly rent";
    if (!(due >= 1 && due <= 28)) e.dueDay = "Pick a day from 1 to 28";
    setErrs(e);
    if (Object.keys(e).length || !r.success || !house) return;
    add.mutate({ houseId: house.id, unit: r.data.unitLabel, name: r.data.name, phone: r.data.phone, emergencyName: r.data.emergencyName, emergencyPhone: r.data.emergencyPhone, emergencyRelationship: r.data.emergencyRelationship, rent, deposit: Number(f.deposit || rent), dueDay: due }, { onSuccess: onDone });
  };

  return (
    <Panel tone="hero" className="grid gap-4 p-5 sm:p-6">
      <h2 className="text-2xl">Add a tenant</h2>
      <p className="text-graphite-300">The tenant's phone and an emergency contact are required. Moving a tenant in lowers the vacant count by one.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="House" value={f.houseId} onChange={(e) => { const h = houses.data?.find((x) => x.id === e.target.value); setF({ ...f, houseId: e.target.value, rent: h ? String(h.rent) : "", deposit: h ? String(h.deposit) : "" }); }} error={errs.houseId}>
          <option value="">Choose a house</option>{houses.data?.map((h) => <option key={h.id} value={h.id}>{h.title} ({h.vacant} vacant)</option>)}
        </SelectField>
        <Field label="Unit label" placeholder="B4" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} error={errs.unitLabel} />
        <Field label="Tenant name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
        <Field label="Tenant phone" type="tel" inputMode="tel" placeholder="0722 111 222" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} />
        <Field label="Emergency contact name" value={f.emergencyName} onChange={(e) => setF({ ...f, emergencyName: e.target.value })} error={errs.emergencyName} />
        <Field label="Emergency contact phone" type="tel" inputMode="tel" value={f.emergencyPhone} onChange={(e) => setF({ ...f, emergencyPhone: e.target.value })} error={errs.emergencyPhone} />
        <Field label="Relationship" placeholder="mother" value={f.emergencyRelationship} onChange={(e) => setF({ ...f, emergencyRelationship: e.target.value })} error={errs.emergencyRelationship} />
        <Field label="Rent per month (KES)" type="number" inputMode="numeric" value={f.rent} onChange={(e) => setF({ ...f, rent: e.target.value })} error={errs.rent} />
        <Field label="Deposit (KES)" type="number" inputMode="numeric" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} />
        <Field label="Rent due on day" type="number" inputMode="numeric" value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: e.target.value })} error={errs.dueDay} hint="1 to 28" />
      </div>
      <p className="text-sm text-graphite-400">Make sure you have the emergency contact's agreement to keep their number.</p>
      <ErrorNote error={add.error} />
      <div className="flex gap-2"><Button magnetic loading={add.isPending} onClick={submit}>Save tenant</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
    </Panel>
  );
}

export function TenantManagement({ t }: { t: TenancyRow }) {
  const update = useLiveMutation("landlord", (p: Parameters<typeof api.landlord.updateTenancy>[1]) => api.landlord.updateTenancy(t.id, p));
  const invite = useLiveMutation<void, InviteResult>("landlord", () => api.landlord.inviteTenant(t.id));
  const end = useLiveMutation("landlord", () => api.landlord.endTenancy(t.id));
  const terminate = useLiveMutation("landlord", () => api.landlord.terminateTenantAccount(t.id));
  const [pb, setPb] = useState(t.kplcPaybill ?? "");
  const [mn, setMn] = useState(t.meterNumber ?? "");
  const [link, setLink] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [msg, setMsg] = useState<string>();

  const sendInvite = () => {
    const whatsapp = window.open("about:blank", "_blank");
    invite.mutate(undefined, {
      onSuccess: (result) => {
        setLink(result);
        setCopied(false);
        if (!whatsapp) return;
        const digits = t.phone.replace(/\D/g, "");
        const phone = digits.startsWith("254") ? digits : `254${digits.replace(/^0/, "")}`;
        const text = `Hi ${t.name}, I’ve added you as a tenant for ${t.houseTitle}, unit ${t.unit}. Set up your HousePlug tenant login here: ${result.link}`;
        whatsapp.opener = null;
        whatsapp.location.href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      },
      onError: () => whatsapp?.close(),
    });
  };
  const inviteText = link && `Hi ${t.name}, I’ve added you as a tenant for ${t.houseTitle}, unit ${t.unit}. Set up your HousePlug tenant login here: ${link.link}`;
  const whatsappPhone = t.phone.replace(/\D/g, "").replace(/^0/, "254");
  const whatsappUrl = inviteText && `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(inviteText)}`;
  return (
    <div className="grid gap-5 border-t border-white/8 p-5">
      <div className="grid gap-2 text-sm text-graphite-200 sm:grid-cols-2">
        <p>Phone: <span className="text-bone">{t.phone}</span></p>
        <p>Emergency: <span className="text-bone">{t.emergencyName} ({t.emergencyRelationship}) {t.emergencyPhone}</span></p>
        <p>Rent: <span className="text-bone">{formatKes(t.rent)}</span>, due on the {t.dueDay}th</p>
        <p>Payment code: <span className="font-mono text-bone">{t.code}</span></p>
      </div>

      {t.status !== "ended" && !t.joined && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={invite.isPending} onClick={sendInvite}>Send WhatsApp invite</Button>
            <span className="text-sm text-graphite-300">Opens a WhatsApp message addressed to the tenant.</span>
          </div>
          <ErrorNote error={invite.error} />
          {link && (
            <div className="rounded-xl border border-white/10 bg-white/4 p-3 text-sm">
              <p>Review the WhatsApp message and press Send. You can also share this invite link:</p>
              <p className="mt-1 break-all text-ember-300">{link.link}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {whatsappUrl && <a className="inline-flex items-center justify-center rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-bone hover:bg-white/8" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>}
                <Button variant="glass" size="sm" onClick={() => { void navigator.clipboard.writeText(link.link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-lg">Electricity tokens</h3>
          <Button variant={t.electricityEnabled ? "primary" : "glass"} size="sm" onClick={() => update.mutate({ electricityEnabled: !t.electricityEnabled })} disabled={!t.electricityEnabled && !(t.kplcPaybill && t.meterNumber)}>{t.electricityEnabled ? "Shown to tenant" : "Hidden from tenant"}</Button></div>
        <p className="text-sm text-graphite-300">Paste the KPLC paybill and this tenant's meter number. They pay KPLC in their own M-Pesa app. It is not part of the rent record.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="KPLC paybill" inputMode="numeric" value={pb} onChange={(e) => setPb(e.target.value.replace(/\D/g, ""))} />
          <Field label="Token meter number" inputMode="numeric" value={mn} onChange={(e) => setMn(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div><Button variant="glass" size="sm" loading={update.isPending} onClick={() => update.mutate({ kplcPaybill: pb || null, meterNumber: mn || null, electricityEnabled: Boolean(pb && mn) && t.electricityEnabled }, { onSuccess: () => setMsg("Electricity details saved.") })}>Save details</Button></div>
      </div>

      {msg && <p role="status" className="text-sm text-ok">{msg}</p>}
      <ErrorNote error={update.error ?? end.error ?? terminate.error} />
      {t.status !== "ended" && (confirmEnd
        ? <div className="grid gap-2">
          <span className="text-sm text-graphite-200">{t.joined
            ? "Move this tenant out and permanently delete their HousePlug login? They will lose access to every tenancy on this account. Tenancy and payment history will be kept."
            : "Move this tenant out? The unit becomes vacant again."}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={t.joined ? terminate.isPending : end.isPending} onClick={() => {
              const mutation = t.joined ? terminate : end;
              mutation.mutate(undefined, { onSuccess: () => { setConfirmEnd(false); setMsg(t.joined ? "Tenant moved out and their account was deleted. Payment history was kept." : "Tenant moved out."); } });
            }}>{t.joined ? "Move out & delete account" : "Yes, move out"}</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)}>Cancel</Button>
          </div>
        </div>
        : <div><Button variant="ghost" size="sm" onClick={() => setConfirmEnd(true)}>{t.joined ? "Move out & delete account" : "Move out"}</Button></div>)}
    </div>
  );
}

export default function Tenants() {
  const { data, isPending, error } = useLive("landlord", "tenants", () => api.landlord.tenants());
  const houses = useLandlordHouses();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [page, setPage] = useState(0);
  const pageSize = 6;
  const allTenants = data ?? [];
  const activeTenants = allTenants.filter((t) => t.status === "active" && t.joined && t.balance <= 0);
  const overdueTenants = allTenants.filter((t) => t.status !== "ended" && t.joined && t.balance > 0);
  const pendingTenants = allTenants.filter((t) => t.status !== "ended" && !t.joined);
  const expectedRent = allTenants.filter((t) => t.status !== "ended").reduce((sum, t) => sum + t.rent, 0);
  const vacantUnits = (houses.data ?? []).reduce((sum, house) => sum + house.vacant, 0);
  const filters = ["All", "Active", "Overdue", "Pending", "Notice", "Former"];
  const statusOf = (t: TenancyRow) => t.status === "ended" ? "Former" : !t.joined ? "Pending" : t.balance > 0 ? "Overdue" : t.status === "notice" ? "Notice" : "Active";
  const visible = useMemo(() => allTenants.filter((t) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [t.name, t.phone, t.houseTitle, t.unit].some((value) => value.toLowerCase().includes(term));
    const status = statusOf(t);
    return matchesSearch && (filter === "All" || status === filter);
  }), [allTenants, filter, search]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageItems = visible.slice(page * pageSize, (page + 1) * pageSize);
  const phoneForWhatsApp = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    return digits.startsWith("254") ? digits : digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  };
  const exportTenants = () => {
    const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      ["Tenant", "Phone", "Property", "Unit", "Monthly rent (KES)", "Balance (KES)", "Status"],
      ...allTenants.map((t) => [t.name, t.phone, t.houseTitle, t.unit, t.rent, t.balance, statusOf(t)]),
    ];
    const csv = rows.map((row) => row.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "houseplug-tenants.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const statusClass = (status: string) => status === "Active"
    ? "bg-emerald-100 text-emerald-800"
    : status === "Overdue"
      ? "bg-red-100 text-red-800"
      : status === "Pending"
        ? "bg-amber-100 text-amber-900"
        : status === "Former"
          ? "bg-slate-100 text-slate-600"
          : "bg-blue-100 text-blue-800";
  const statusBadge = (t: TenancyRow) => {
    const status = statusOf(t);
    return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>
      {status === "Active" ? <CheckCircle2 className="size-3.5" aria-hidden /> : status === "Overdue" ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
      {status}
    </span>;
  };
  const directoryRows = (items: TenancyRow[]) => items.map((t) => (
      <tr className="border-t border-slate-100 hover:bg-slate-50/80">
        <td className="px-3 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-pink-100 text-xs font-extrabold text-rose-900">{t.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
            <div className="min-w-32"><p className="font-bold text-slate-900">{t.name}</p><p className="text-xs text-slate-500">{t.phone}</p></div>
          </div>
        </td>
        <td className="px-3 py-3.5 text-sm text-slate-700">{t.houseTitle}</td>
        <td className="px-3 py-3.5 text-sm font-semibold text-slate-800">{t.unit}</td>
        <td className="px-3 py-3.5 text-sm font-bold text-slate-800">{formatKes(t.rent)}</td>
        <td className={`px-3 py-3.5 text-sm font-bold ${t.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>{formatKes(t.balance)}</td>
        <td className="px-3 py-3.5">{statusBadge(t)}</td>
        <td className="px-3 py-3.5">
          <div className="flex items-center gap-1.5">
            <Link to={`/landlord/tenants/${t.id}`} className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"><Eye className="mr-1 size-4" aria-hidden />View</Link>
            {t.status !== "ended" && <a className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-emerald-800 hover:bg-emerald-50" href={`https://wa.me/${phoneForWhatsApp(t.phone)}?text=${encodeURIComponent(`Hi ${t.name}, I am following up about your tenancy at ${t.houseTitle}, unit ${t.unit}.`)}`} target="_blank" rel="noopener noreferrer" aria-label={`Message ${t.name} on WhatsApp`}><MessageCircle className="size-4" aria-hidden /></a>}
          </div>
        </td>
      </tr>
  ));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-pink-100 text-rose-900"><Users className="size-6" aria-hidden /></span>
          <div><h2 className="text-3xl font-bold text-slate-900">Tenants</h2><p className="text-sm text-slate-600">Manage tenancies, rent status, and tenant records.</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" onClick={exportTenants} disabled={allTenants.length === 0}><Download className="mr-1.5 size-4" aria-hidden />Export tenants</Button>
          {!adding && <Button magnetic onClick={() => setAdding(true)}><Plus className="mr-1.5 size-4" aria-hidden />Add tenant</Button>}
        </div>
      </div>
      {adding && <AddTenant onDone={() => setAdding(false)} />}
      <ErrorNote error={error} />
      {isPending && <div className="skeleton h-24" />}
      <section aria-label="Tenant summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { title: "Total tenants", value: String(allTenants.length), icon: Users, tone: "border-pink-100 bg-pink-50 text-rose-900" },
          { title: "Active tenants", value: String(activeTenants.length), icon: CheckCircle2, tone: "border-emerald-100 bg-emerald-50 text-emerald-800" },
          { title: "Rent overdue", value: String(overdueTenants.length), icon: TriangleAlert, tone: "border-orange-100 bg-orange-50 text-orange-800" },
          { title: "Vacant units", value: houses.isPending || houses.isError ? "—" : String(vacantUnits), icon: Building2, tone: "border-indigo-100 bg-indigo-50 text-indigo-800" },
        ].map(({ title, value, icon: Icon, tone }) => (
          <Panel key={title} className={`flex items-center gap-3 border p-3.5 sm:p-4 ${tone}`}>
            <Icon className="size-8 shrink-0" aria-hidden />
            <div className="min-w-0"><p className="text-2xl font-extrabold leading-tight">{value}</p><p className="truncate text-xs font-semibold sm:text-sm">{title}</p></div>
          </Panel>
        ))}
      </section>
      <Panel className="flex flex-wrap items-center gap-3 border-emerald-100 bg-gradient-to-r from-emerald-50 to-white p-4 sm:px-5">
        <span className="grid size-11 place-items-center rounded-full bg-emerald-100 text-emerald-800"><CircleDollarSign className="size-6" aria-hidden /></span>
        <div><p className="text-sm font-bold text-slate-800">Expected monthly rent</p><p className="text-2xl font-extrabold text-slate-900">{formatKes(expectedRent)}</p></div>
        <span className="ml-auto text-sm font-semibold text-emerald-800">Based on current tenancies</span>
      </Panel>

      <Panel id="tenant-directory" className="scroll-mt-24 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <h3 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Users className="size-5 text-rose-900" aria-hidden />Tenant directory</h3>
          <label className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <span className="sr-only">Search tenants</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search name, phone, property or unit…" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
          {filters.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => { setFilter(item); setPage(0); }} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${filter === item ? "border-rose-900 bg-rose-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{item}{item === "Pending" && pendingTenants.length > 0 ? ` (${pendingTenants.length})` : ""}</button>)}
        </div>
        {allTenants.length === 0 && !isPending
          ? <div className="border-t border-slate-100 p-5"><ToLet title="No tenants yet" note="Add a tenant when someone moves in. They can join through a WhatsApp invite and manage their rent from the tenant portal." /></div>
          : visible.length === 0
            ? <p className="border-t border-slate-100 p-5 text-sm text-slate-600">No tenants match this search or status.</p>
            : <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] border-collapse text-left">
                  <thead className="bg-slate-50 text-xs font-bold text-slate-600"><tr>
                    <th className="px-3 py-3">Tenant</th><th className="px-3 py-3">Property</th><th className="px-3 py-3">House / unit</th><th className="px-3 py-3">Monthly rent</th><th className="px-3 py-3">Balance</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Actions</th>
                  </tr></thead>
                  <tbody>{directoryRows(pageItems)}</tbody>
                </table>
              </div>
              <div className="divide-y divide-slate-100 border-t border-slate-100 md:hidden">
                {pageItems.map((t) => (
                  <article key={t.id} className="grid gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-bold text-slate-900">{t.name}</p><p className="text-sm text-slate-500">{t.phone}</p></div>{statusBadge(t)}
                    </div>
                    <p className="text-sm text-slate-700">{t.houseTitle} · Unit {t.unit}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Rent <b className="text-slate-900">{formatKes(t.rent)}</b></span><span>Balance <b className={t.balance > 0 ? "text-red-700" : "text-emerald-700"}>{formatKes(t.balance)}</b></span></div>
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/landlord/tenants/${t.id}`} className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"><Eye className="mr-1 size-4" aria-hidden />View profile</Link>
                      {t.status !== "ended" && <a className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-emerald-800" href={`https://wa.me/${phoneForWhatsApp(t.phone)}?text=${encodeURIComponent(`Hi ${t.name}, I am following up about your tenancy at ${t.houseTitle}, unit ${t.unit}.`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" aria-hidden />WhatsApp</a>}
                    </div>
                  </article>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 sm:px-5">
                <p>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, visible.length)} of {visible.length} tenants</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="glass" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} aria-label="Previous page"><ChevronLeft className="size-4" aria-hidden /></Button>
                  <span className="min-w-16 text-center text-xs font-semibold">Page {page + 1} of {pageCount}</span>
                  <Button size="sm" variant="glass" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} aria-label="Next page"><ChevronRight className="size-4" aria-hidden /></Button>
                </div>
              </div>
            </>}
      </Panel>

      <Panel className="p-4 sm:p-5">
        <h3 className="text-lg font-bold text-slate-900">Quick actions</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { to: "/landlord/finances", title: "View rent history", icon: CircleDollarSign },
            { to: "/landlord/tenants#tenant-directory", title: "Manage agreements", icon: Building2 },
            { to: "/landlord/complaints", title: "Track maintenance", icon: Wrench },
            { to: "#tenant-directory", title: "Contact tenants", icon: MessageCircle },
          ].map(({ to, title, icon: Icon }) => <Link key={title} to={to} className="flex items-center justify-center gap-2 rounded-xl border border-pink-100 bg-pink-50/70 px-3 py-3 text-sm font-bold text-rose-900 hover:bg-pink-100"><Icon className="size-4" aria-hidden />{title}<ArrowRight className="size-4" aria-hidden /></Link>)}
        </div>
      </Panel>
    </div>
  );
}
