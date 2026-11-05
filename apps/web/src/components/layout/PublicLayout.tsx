import { Link, Outlet, useLocation } from "react-router-dom";
import { CircleHelp, House, Info, Search } from "lucide-react";
import { Ambient } from "./Ambient";

export function PublicLayout() {
  const isHome = useLocation().pathname === "/";
  return (
    <>
      <Ambient />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="relative block size-10 shrink-0 overflow-hidden" aria-hidden="true">
              <img src="/houseplug-kenya-mark.png" alt="" className="absolute -left-px -top-px w-[42px] max-w-none" />
            </span>
            <span className="grid text-sm font-extrabold leading-tight sm:text-base">
              <span className="text-rose-900">HousePlug</span>
              <span className="text-emerald-700">Kenya</span>
            </span>
            <span className="sr-only">HousePlug Kenya — Find, Book, Manage</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            <Link to="/" className="inline-flex items-center gap-2 rounded-lg bg-rose-900 px-3 py-2 text-sm font-semibold text-white"><House className="size-4" aria-hidden />Home</Link>
            <Link to="/#properties" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Search className="size-4" aria-hidden />Properties</Link>
            <Link to="/about" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Info className="size-4" aria-hidden />About Us</Link>
            {isHome
              ? <a href="https://wa.me/254799326074" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><CircleHelp className="size-4" aria-hidden />Help</a>
              : <Link to="/sign-in" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><CircleHelp className="size-4" aria-hidden />Help</Link>}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {isHome && <a href="https://wa.me/254799326074" target="_blank" rel="noreferrer" aria-label="Help on WhatsApp" className="grid size-9 place-items-center rounded-full text-slate-700 hover:bg-slate-100 md:hidden"><CircleHelp className="size-5" aria-hidden /></a>}
            <Link to="/sign-in" className="rounded-full border border-rose-800 px-3 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-50">Sign in</Link>
            <Link to="/sign-up" className="rounded-full bg-rose-900 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-800">Register</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full px-3 pb-16 pt-4 sm:px-6"><Outlet /></main>
      <footer className="mx-auto grid w-full gap-8 px-3 pb-8 text-sm text-graphite-400 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        <div className="grid content-start gap-3">
          <span className="font-medium text-bone">HousePlug Kenya</span>
          <Link to="/about#about-rental-houses" className="w-fit hover:text-bone">About the service</Link>
          <Link to="/about#why-we-ask" className="w-fit hover:text-bone">Why we ask for information</Link>
        </div>
        <nav aria-label="For landlords" className="grid content-start gap-3">
          <Link to="/about#for-landlords" className="w-fit font-medium text-bone hover:text-ember-300">For landlords</Link>
          <Link to="/sign-up" className="w-fit hover:text-bone">Create a landlord account</Link>
        </nav>
        <div className="grid content-start gap-3">
          <nav aria-label="For tenants" className="grid content-start gap-3">
            <Link to="/about#for-tenants" className="w-fit font-medium text-bone hover:text-ember-300">For tenants</Link>
          </nav>
          <nav aria-label="Support" className="grid content-start gap-3">
            <span className="font-medium text-bone">Help & support</span>
            {isHome
              ? <a href="https://wa.me/254799326074" target="_blank" rel="noreferrer" className="w-fit hover:text-bone">Message us on WhatsApp</a>
              : <Link to="/sign-in" className="w-fit hover:text-bone">Sign in to send an issue</Link>}
          </nav>
          <nav aria-label="Legal" className="grid content-start gap-3">
            <Link to="/privacy" className="w-fit hover:text-bone">Privacy policy</Link>
            <Link to="/terms" className="w-fit hover:text-bone">Terms of service</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
