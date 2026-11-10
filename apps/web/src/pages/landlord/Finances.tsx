import { ArrowDown, CreditCard, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import MpesaSetup from "./MpesaSetup";
import Payments from "./Payments";

export default function Finances() {
  return (
    <div className="landlord-payments-page grid gap-4 sm:gap-5">
      <header className="landlord-payments-hero relative isolate flex min-h-36 flex-col justify-between gap-5 overflow-hidden rounded-2xl px-4 py-4 text-white shadow-sm sm:min-h-40 sm:flex-row sm:items-end sm:px-6 sm:py-5">
        <div className="relative z-10 flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/25 bg-white/10 sm:size-14">
            <CreditCard className="size-7 sm:size-8" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold sm:text-3xl">Payments</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-white/85 sm:text-sm">
              Manage how tenants pay rent, configure your receiving account, and review your rent ledger.
            </p>
          </div>
        </div>
        <nav aria-label="Payment sections" className="relative z-10 flex flex-wrap gap-2">
          <Link to="#payment-setup" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/40 bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20 sm:text-sm">
            <ShieldCheck className="size-4" aria-hidden />Payment setup
          </Link>
          <Link to="#ledger" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-950 transition-colors hover:bg-emerald-50 sm:text-sm">
            <ArrowDown className="size-4" aria-hidden />Rent ledger
          </Link>
        </nav>
      </header>
      <MpesaSetup embedded />
      <Payments embedded />
    </div>
  );
}
