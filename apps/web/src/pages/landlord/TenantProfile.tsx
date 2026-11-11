import { useState } from "react";
import {
  ArrowLeft, ArrowRight, Bell, CalendarDays, CheckCircle2, ChevronDown, CircleDollarSign, Clock3,
  FileText, House, MessageCircle, Phone, ReceiptText, Shield, Upload, UserRound, Wrench,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { ComplaintItem, LedgerRow, TenancyRow } from "@/api/types";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { FileField } from "@/components/ui/FileField";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLandlordHouses } from "@/features/landlord/hooks";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes, todayIso } from "@/lib/format";
import { TenantManagement } from "./Tenants";

type Tab = "Overview" | "Rent & Payments" | "Documents" | "Maintenance" | "Communication" | "Tenancy History";
const tabs: { label: Tab; icon: typeof House }[] = [
  { label: "Overview", icon: House },
  { label: "Rent & Payments", icon: ReceiptText },
  { label: "Documents", icon: FileText },
  { label: "Maintenance", icon: Wrench },
  { label: "Communication", icon: MessageCircle },
  { label: "Tenancy History", icon: Clock3 },
];

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function statusLabel(t: TenancyRow) {
  if (t.status === "ended") return "Former tenant";
  if (!t.joined) return "Invitation pending";
  if (t.status === "notice") return "Notice given";
  return "Active tenant";
}

function RentAmount({ row }: { row: LedgerRow }) {
  const reversed = row.kind === "reversal";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full ${reversed ? "bg-orange-100 text-orange-800" : "bg-emerald-100 text-emerald-800"}`}>
          {reversed ? <ArrowLeft className="size-5" aria-hidden /> : <CheckCircle2 className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="font-bold text-slate-900">{reversed ? "Payment reversed" : row.kind === "deposit_payment" ? "Deposit received" : "Rent payment received"}</p>
          <p className="text-sm text-slate-500">{fmtDate(row.at)}{row.method ? ` · ${row.method.replaceAll("_", " ")}` : ""}{row.receipt ? ` · ${row.receipt}` : ""}</p>
        </div>
      </div>
      <p className={`font-extrabold ${reversed ? "text-orange-800" : "text-emerald-800"}`}>{reversed ? "−" : ""}{formatKes(row.amount)}</p>
    </div>
  );
}

export default function TenantProfile() {
  const { id = "" } = useParams();
  const [tab, setTab] = useState<Tab>("Overview");
  const [scan, setScan] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [fileError, setFileError] = useState<string>();
  const tenants = useLive("landlord", "tenants", () => api.landlord.tenants());
  const tenantLedger = useLive("landlord", `tenant-profile-ledger-${id}`, () => api.landlord.tenantLedger(id), { enabled: !!id });
  const complaints = useLive("landlord", "tenant-profile-complaints", () => api.landlord.complaints());
  const houses = useLandlordHouses();
  const agreementUpdate = useLiveMutation("landlord", (v: { tenancyId: string; signedOn: string }) =>
    api.landlord.updateTenancy(v.tenancyId, { agreementSignedOn: v.signedOn }));
  const agreementUpload = useLiveMutation("landlord", (v: { tenancyId: string; file: File }) =>
    api.landlord.uploadAgreement(v.tenancyId, v.file));
  const sendMessage = useLiveMutation("landlord", (v: { tenancyId: string; text: string }) =>
    api.landlord.broadcast("tenancy", v.tenancyId, v.text));

  const t = tenants.data?.find((row) => row.id === id);
  const house = houses.data?.find((row) => row.id === t?.houseId);
  const ledger = tenantLedger.data ?? [];
  const tenantComplaints = (complaints.data ?? []).filter((item) => item.tenancyId === id);
  const rentPaid = ledger.reduce((sum, row) => sum + (row.kind === "rent_payment" ? row.amount : row.kind === "reversal" && row.bucket === "rent" ? -row.amount : 0), 0);
  const currentStatus = t ? statusLabel(t) : "";

  const openAgreement = async () => {
    if (!t?.agreementPath) return;
    setFileError(undefined);
    const agreementWindow = window.open("about:blank", "_blank");
    if (!agreementWindow) {
      setFileError("Allow pop-ups to open the tenancy agreement.");
      return;
    }
    try {
      const url = await api.landlord.fileUrl("agreements", t.agreementPath);
      agreementWindow.opener = null;
      agreementWindow.location.href = url;
    } catch (error) {
      agreementWindow.close();
      setFileError(error instanceof Error ? error.message : "Could not open the tenancy agreement.");
    }
  };
  const saveAgreement = () => {
    if (!t || !scan) return;
    agreementUpload.mutate({ tenancyId: t.id, file: scan }, { onSuccess: () => { setScan(null); setFileError(undefined); } });
  };

  if (tenants.isPending) return <div className="skeleton h-64" />;
  if (tenants.error) return <ErrorNote error={tenants.error} />;
  if (!t) return (
    <Panel className="grid gap-3 p-6 text-center">
      <h2 className="text-xl font-bold text-slate-900">Tenant not found</h2>
      <p className="text-sm text-slate-600">This tenancy may have been removed or may not belong to your account.</p>
      <Link to="/landlord/tenants" className="mx-auto inline-flex items-center gap-2 font-semibold text-rose-900"><ArrowLeft className="size-4" aria-hidden />Back to tenants</Link>
    </Panel>
  );

  const phoneDigits = t.phone.replace(/\D/g, "");
  const whatsappPhone = phoneDigits.startsWith("254") ? phoneDigits : `254${phoneDigits.replace(/^0/, "")}`;
  const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`Hi ${t.name}, I am following up about your tenancy at ${t.houseTitle}, unit ${t.unit}.`)}`;
  const actions = [
    { title: "Send rent reminder", icon: Bell, run: () => { setMessage(`Hello ${t.name}, this is a reminder that your rent of ${formatKes(t.rent)} is due on the ${t.dueDay}th. Please contact me if you have already paid.`); setTab("Communication"); } },
    { title: "Review rent payments", icon: ReceiptText, href: "/landlord/finances#ledger" },
    { title: "Upload document", icon: Upload, run: () => setTab("Documents") },
    { title: "View tenancy history", icon: CalendarDays, run: () => setTab("Tenancy History") },
  ];

  return (
    <div className="grid gap-4">
      <div className="text-sm font-semibold text-slate-500">
        <Link to="/landlord/tenants" className="hover:text-rose-900">Tenants</Link><span className="mx-2">›</span><span className="text-rose-900">{t.name}</span>
      </div>
      <header className="border-b-2 border-rose-700 pb-3">
        <h1 className="text-3xl font-extrabold text-rose-900">Tenant Profile</h1>
        <p className="mt-1 text-sm text-slate-600">View and manage tenant information, payments, and tenancy details.</p>
      </header>
      <ErrorNote error={houses.error} />

      <Panel className="flex flex-wrap items-center justify-between gap-4 border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-full bg-pink-100 text-2xl font-extrabold text-rose-900">{initials(t.name)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-extrabold text-slate-900">{t.name}</h2><Chip tone={t.status === "ended" ? "neutral" : t.joined ? "ok" : "ember"}>{currentStatus}</Chip></div>
            <p className="text-sm text-slate-500">Tenant ID: {t.code}</p>
            <a className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-rose-900" href={`tel:${t.phone}`}><Phone className="size-4" aria-hidden />{t.phone}</a>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`tel:${t.phone}`} className="inline-flex items-center gap-2 rounded-xl bg-rose-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-800"><Phone className="size-4" aria-hidden />Call tenant</a>
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-bold text-rose-900 hover:bg-pink-50"><MessageCircle className="size-4" aria-hidden />Send message</a>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50">More actions <ChevronDown className="size-4" aria-hidden /></summary>
            <div className="absolute right-0 z-10 mt-2 grid min-w-48 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <button className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setTab("Documents")}>Documents</button>
              <button className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setTab("Tenancy History")}>Tenancy history</button>
              <Link to="/landlord/finances#ledger" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Rent ledger</Link>
            </div>
          </details>
        </div>
      </Panel>

      <section aria-label="Tenant rent summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Monthly rent", value: formatKes(t.rent), icon: House, color: "bg-pink-100 text-rose-900" },
          { label: "Total paid", value: formatKes(rentPaid), icon: CheckCircle2, color: "bg-emerald-100 text-emerald-800" },
          { label: "Outstanding", value: formatKes(Math.max(0, t.balance)), icon: CircleDollarSign, color: "bg-orange-100 text-orange-800" },
          { label: "Deposit", value: formatKes(t.deposit), icon: Shield, color: "bg-indigo-100 text-indigo-800" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Panel key={label} className="border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3"><span className={`grid size-10 place-items-center rounded-xl ${color}`}><Icon className="size-5" aria-hidden /></span><p className="text-sm font-semibold text-slate-600">{label}</p></div>
            <p className="mt-3 text-2xl font-extrabold text-slate-900">{value}</p>
            {label === "Outstanding" && t.balance < 0 && <p className="mt-1 text-xs text-emerald-700">Rent credit {formatKes(-t.balance)}</p>}
          </Panel>
        ))}
      </section>

      <Panel className="grid gap-4 border-slate-200 bg-white p-4 sm:grid-cols-[minmax(12rem,1.1fr)_repeat(4,minmax(7rem,1fr))] sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {house?.coverPhoto ? <img src={house.coverPhoto} alt="" className="size-20 rounded-xl object-cover" /> : <span className="grid size-20 place-items-center rounded-xl bg-pink-50 text-rose-900"><House className="size-8" aria-hidden /></span>}
          <div className="min-w-0"><h3 className="font-extrabold text-slate-900">{t.houseTitle}</h3><p className="text-sm text-slate-500">{house ? `${house.town}, ${house.county}` : `Unit ${t.unit}`}</p><Chip tone={t.status === "ended" ? "neutral" : "ok"}>{t.status === "ended" ? "Former tenancy" : "Occupied"}</Chip></div>
        </div>
        <div className="border-l border-slate-200 pl-3"><p className="text-xs text-slate-500">House / unit</p><p className="mt-1 font-bold text-slate-900">{house?.type ?? "—"} · {t.unit}</p></div>
        <div className="border-l border-slate-200 pl-3"><p className="text-xs text-slate-500">Move-in date</p><p className="mt-1 font-bold text-slate-900">{fmtDate(t.startedOn)}</p></div>
        <div className="border-l border-slate-200 pl-3"><p className="text-xs text-slate-500">Rent due date</p><p className="mt-1 font-bold text-slate-900">{t.dueDay}th monthly</p></div>
        <div className="border-l border-slate-200 pl-3"><p className="text-xs text-slate-500">Agreement</p><p className="mt-1 font-bold text-slate-900">{t.agreementSignedOn ? `Signed ${fmtDate(t.agreementSignedOn)}` : "Not signed"}</p></div>
      </Panel>

      <nav aria-label="Tenant profile sections" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {tabs.map(({ label, icon: Icon }) => <button key={label} type="button" aria-pressed={tab === label} onClick={() => setTab(label)} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-xs font-bold transition sm:text-sm ${tab === label ? "border-rose-900 bg-rose-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}><Icon className="size-4 shrink-0" aria-hidden />{label}</button>)}
      </nav>

      {tab === "Overview" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.9fr)]">
          <Panel className="border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-extrabold text-rose-900">Recent activity</h3><button type="button" onClick={() => setTab("Rent & Payments")} className="inline-flex items-center gap-1 text-sm font-bold text-rose-900">View all <ArrowRight className="size-4" aria-hidden /></button></div>
            {tenantLedger.isPending ? <p className="mt-4 text-sm text-slate-500">Loading tenant activity…</p> : tenantLedger.error ? <ErrorNote error={tenantLedger.error} /> : ledger.slice(0, 5).length ? <div className="mt-2">{ledger.slice(0, 5).map((row) => <RentAmount key={row.id} row={row} />)}</div> : <p className="mt-4 text-sm text-slate-500">No rent payments have been recorded for this tenancy yet.</p>}
            <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600 sm:grid-cols-2">
              <p className="flex items-center gap-2"><Phone className="size-4 text-rose-800" aria-hidden />{t.phone}</p>
              <p className="flex items-center gap-2"><UserRound className="size-4 text-rose-800" aria-hidden />Emergency: {t.emergencyName} ({t.emergencyRelationship})</p>
              <p className="sm:col-span-2">{t.emergencyPhone}</p>
            </div>
          </Panel>
          <Panel className="grid content-start gap-3 border-pink-200 bg-pink-50/70 p-4 sm:p-5">
            <h3 className="text-lg font-extrabold text-rose-900">Quick actions</h3>
            {actions.map(({ title, icon: Icon, run, href }) => href
              ? <Link key={title} to={href} className="flex items-center justify-between gap-2 rounded-xl border border-pink-200 bg-white px-3 py-3 text-sm font-bold text-rose-900 hover:bg-pink-50"><span className="flex items-center gap-2"><Icon className="size-4" aria-hidden />{title}</span><ArrowRight className="size-4" aria-hidden /></Link>
              : <button key={title} type="button" onClick={run} className="flex items-center justify-between gap-2 rounded-xl border border-pink-200 bg-white px-3 py-3 text-left text-sm font-bold text-rose-900 hover:bg-pink-50"><span className="flex items-center gap-2"><Icon className="size-4" aria-hidden />{title}</span><ArrowRight className="size-4" aria-hidden /></button>)}
            <div className="mt-1 rounded-xl border border-orange-200 bg-orange-50 p-3">
              <p className="font-bold text-slate-900">Need assistance?</p>
              <p className="mt-1 text-sm text-slate-600">Contact the tenant directly or get help from support.</p>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-rose-900 px-3 py-2 text-sm font-bold text-white">Message tenant <ArrowRight className="size-4" aria-hidden /></a>
            </div>
          </Panel>
          <Panel id="tenant-actions" className="border-slate-200 bg-white p-4 sm:col-span-2 sm:p-5">
            <h3 className="mb-3 text-lg font-extrabold text-slate-900">Manage tenancy</h3>
            <TenantManagement t={t} />
          </Panel>
        </div>
      )}

      {tab === "Rent & Payments" && (
        <Panel className="border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xl font-extrabold text-rose-900">Rent & payments</h3><p className="text-sm text-slate-600">Confirmed rent payments and reversals for this tenancy.</p></div><Link to="/landlord/finances#ledger" className="text-sm font-bold text-rose-900">Open rent ledger</Link></div>
          <ErrorNote error={tenantLedger.error} />
          {tenantLedger.isPending ? <p className="py-5 text-sm text-slate-500">Loading rent history…</p> : ledger.length ? <div className="mt-3">{ledger.map((row) => <RentAmount key={row.id} row={row} />)}</div> : <p className="py-5 text-sm text-slate-500">No payments have been recorded for this tenancy yet.</p>}
        </Panel>
      )}

      {tab === "Documents" && (
        <Panel className="grid gap-4 border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xl font-extrabold text-rose-900">Tenancy documents</h3><p className="text-sm text-slate-600">Upload the signed agreement for both landlord and tenant access.</p></div><Chip tone={t.agreementPath ? "ok" : "neutral"}>{t.agreementPath ? "Agreement uploaded" : "No agreement uploaded"}</Chip></div>
          <p className="text-sm text-slate-600">{t.agreementSignedOn ? `Marked as signed on ${fmtDate(t.agreementSignedOn)}.` : "The agreement has not been marked as signed."}</p>
          {t.agreementPath && <Button variant="glass" className="w-fit text-slate-800" onClick={() => void openAgreement()}><FileText className="size-4" aria-hidden />Download agreement</Button>}
          {!t.agreementSignedOn && <Button variant="glass" className="w-fit text-slate-800" loading={agreementUpdate.isPending} onClick={() => agreementUpdate.mutate({ tenancyId: t.id, signedOn: todayIso() })}>Mark agreement as signed today</Button>}
          <FileField label={t.agreementPath ? "Replace agreement" : "Upload tenancy agreement"} hint="PDF, JPG or PNG, up to 5 MB." file={scan} onPick={setScan} />
          {scan && <Button className="w-fit" loading={agreementUpload.isPending} onClick={saveAgreement}>{t.agreementPath ? "Replace agreement" : "Upload agreement"}</Button>}
          <ErrorNote error={fileError ?? agreementUpdate.error ?? agreementUpload.error} />
        </Panel>
      )}

      {tab === "Maintenance" && (
        <Panel className="border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xl font-extrabold text-rose-900">Maintenance requests</h3><p className="text-sm text-slate-600">Requests submitted by this tenant.</p></div><Link to="/landlord/complaints" className="text-sm font-bold text-rose-900">Open maintenance</Link></div>
          <ErrorNote error={complaints.error} />
          {complaints.isPending ? <p className="py-5 text-sm text-slate-500">Loading maintenance requests…</p> : tenantComplaints.length ? <div className="mt-3 grid gap-2">{tenantComplaints.map((item) => <ComplaintCard key={item.id} item={item} />)}</div> : <p className="py-5 text-sm text-slate-500">No maintenance requests have been submitted by this tenant.</p>}
        </Panel>
      )}

      {tab === "Communication" && (
        <Panel className="grid gap-4 border-slate-200 bg-white p-4 sm:p-5">
          <div><h3 className="text-xl font-extrabold text-rose-900">Communication</h3><p className="text-sm text-slate-600">Send a WhatsApp message or an SMS to this tenant.</p></div>
          <div className="flex flex-wrap gap-2"><a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-50"><MessageCircle className="size-4" aria-hidden />Open WhatsApp</a><a href={`tel:${t.phone}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"><Phone className="size-4" aria-hidden />Call tenant</a></div>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">SMS message<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={480} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-rose-500 focus:outline-none" placeholder="Write a message for this tenant" /></label>
          <p className="text-xs text-slate-500">SMS delivery uses your landlord SMS balance.</p>
          <ErrorNote error={sendMessage.error} />
          <Button className="w-fit" loading={sendMessage.isPending} disabled={!message.trim() || t.status === "ended"} onClick={() => sendMessage.mutate({ tenancyId: t.id, text: message.trim() })}>Send SMS</Button>
        </Panel>
      )}

      {tab === "Tenancy History" && (
        <Panel className="border-slate-200 bg-white p-4 sm:p-5">
          <h3 className="text-xl font-extrabold text-rose-900">Tenancy history</h3>
          <div className="mt-3 grid gap-3">
            <HistoryItem title="Tenancy started" date={fmtDate(t.startedOn)} note={`${t.houseTitle}, unit ${t.unit}`} />
            {t.joined && <HistoryItem title="Tenant account joined" date="Account linked" note="The tenant can access their tenant dashboard." />}
            {t.agreementSignedOn && <HistoryItem title="Agreement signed" date={fmtDate(t.agreementSignedOn)} note={t.agreementPath ? "Agreement document on file." : "No agreement file uploaded."} />}
            {ledger.map((row) => <HistoryItem key={row.id} title={row.kind === "reversal" ? "Rent payment reversed" : row.kind === "deposit_payment" ? "Deposit payment" : "Rent payment"} date={fmtDate(row.at)} note={`${formatKes(row.amount)}${row.receipt ? ` · ${row.receipt}` : ""}`} />)}
            {t.status === "ended" && <HistoryItem title="Tenancy ended" date="Former tenancy" note="The tenancy is no longer active." />}
          </div>
        </Panel>
      )}
    </div>
  );
}

function ComplaintCard({ item }: { item: ComplaintItem }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
      <div><p className="font-bold text-slate-900">{item.title}</p><p className="text-sm text-slate-500">{item.category} · {fmtDate(item.at)}</p></div>
      <Chip tone={item.status === "resolved" ? "ok" : item.status === "in_progress" ? "ember" : "neutral"}>{item.status.replaceAll("_", " ")}</Chip>
    </div>
  );
}

function HistoryItem({ title, date, note }: { title: string; date: string; note: string }) {
  return <div className="flex gap-3 border-l-2 border-rose-200 pl-3"><span className="mt-1 size-2.5 shrink-0 rounded-full bg-rose-700" /><div><p className="font-bold text-slate-900">{title}</p><p className="text-sm text-slate-500">{date} · {note}</p></div></div>;
}
