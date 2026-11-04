import { Link } from "react-router-dom";
import { PageHead } from "@/components/ui/PageHead";
import MpesaSetup from "./MpesaSetup";
import Payments from "./Payments";

export default function Finances() {
  return (
    <div className="grid gap-5">
      <PageHead
        title="Finances"
        sub="Manage how tenants pay rent, configure your receiving account, and review your rent ledger."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="#payment-setup" className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-blue-100 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-blue-50">Payment setup</Link>
            <Link to="#ledger" className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-blue-100 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-blue-50">Rent ledger</Link>
          </div>
        }
      />
      <MpesaSetup embedded />
      <Payments embedded />
    </div>
  );
}
