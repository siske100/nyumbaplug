import { useParams } from "react-router-dom";
import { api } from "@/api";
import { useSession } from "@/features/auth/useSession";
import { useLive } from "@/features/live";
import { Button } from "@/components/ui/Button";
import { fmtDate, formatKes, todayIso } from "@/lib/format";

/** A plain white page meant for the printer. This is a standard template: have a lawyer review it before real use. */
export default function AgreementPrint() {
  const { id = "" } = useParams();
  const { data: session } = useSession();
  const tenants = useLive("landlord", "tenants", () => api.landlord.tenants());
  const t = tenants.data?.find((x) => x.id === id);
  if (!t) return <p className="p-8 text-graphite-300">{tenants.isPending ? "Loading..." : "Tenant not found."}</p>;

  return (
    <div className="min-h-screen bg-white p-6 text-black print:p-0" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          <span>Standard template. Have a lawyer review it before real use. Print two copies: one for you, one for the tenant.</span>
          <Button onClick={() => window.print()}>Print</Button>
        </div>
        <h1 className="text-center text-2xl font-bold">TENANCY AGREEMENT</h1>
        <p className="mt-6">This agreement is made on {fmtDate(todayIso())} between:</p>
        <p className="mt-3"><b>Landlord:</b> {session?.name} (the "Landlord")</p>
        <p className="mt-1"><b>Tenant:</b> {t.name}, phone {t.phone} (the "Tenant")</p>
        <p className="mt-1"><b>Emergency contact of the Tenant:</b> {t.emergencyName} ({t.emergencyRelationship}), phone {t.emergencyPhone}</p>
        <p className="mt-3"><b>Premises:</b> {t.houseTitle}, unit {t.unit}.</p>
        <ol className="mt-6 grid list-decimal gap-3 pl-6">
          <li><b>Rent.</b> The Tenant pays {formatKes(t.rent)} per month, due on the {t.dueDay}th day of each month, by M-Pesa through the Rental Houses platform using payment code <b>{t.code}</b>. The full amount due is paid each time.</li>
          <li><b>Deposit.</b> The Tenant pays a deposit of {formatKes(t.deposit)} on signing. It is refundable when the Tenant moves out, after deducting unpaid rent and the cost of damage beyond normal wear.</li>
          <li><b>Notice.</b> Either party ends this agreement by giving one month's written notice.</li>
          <li><b>Use.</b> The premises are for residential use by the Tenant only. The Tenant does not sublet, keeps the premises clean, and does not cause a nuisance to neighbours.</li>
          <li><b>Utilities.</b> {t.electricityEnabled && t.meterNumber ? `Electricity is on the Tenant's own prepaid meter number ${t.meterNumber}, paid by the Tenant.` : "Utilities are paid as agreed between the parties."}</li>
          <li><b>Repairs.</b> The Tenant reports faults promptly through the platform. The Landlord keeps the structure and shared facilities in good repair.</li>
          <li><b>Records.</b> Payments recorded on the Rental Houses platform are the official record of rent paid.</li>
          <li><b>House rules.</b> The Tenant follows the house rules shown on the listing, which form part of this agreement.</li>
        </ol>
        <div className="mt-12 grid grid-cols-2 gap-10">
          <div><div className="h-12 border-b border-black" /><p className="mt-1 text-sm">Landlord signature and date</p></div>
          <div><div className="h-12 border-b border-black" /><p className="mt-1 text-sm">Tenant signature and date</p></div>
          <div><div className="h-12 border-b border-black" /><p className="mt-1 text-sm">Witness name, signature and date</p></div>
        </div>
      </div>
    </div>
  );
}
