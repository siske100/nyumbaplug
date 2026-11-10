import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { CircleHelp, House, Info, Menu, Search, X } from "lucide-react";
import { Ambient } from "./Ambient";

export function PublicLayout() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <Ambient />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5" aria-label="HousePlug Kenya home">
            <img src="/houseplug-kenya-wordmark.png" alt="HousePlug Kenya" className="h-8 w-auto sm:h-10 lg:h-12" />
            <span className="sr-only">HousePlug Kenya — Find, Book, Manage</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            <Link to="/" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"><House className="size-4" aria-hidden />Home</Link>
            <Link to="/#properties" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Search className="size-4" aria-hidden />Properties</Link>
            <Link to="/about" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Info className="size-4" aria-hidden />About Us</Link>
            {isHome
              ? <a href="https://wa.me/254799326074" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><CircleHelp className="size-4" aria-hidden />Help</a>
              : <Link to="/sign-in" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><CircleHelp className="size-4" aria-hidden />Help</Link>}
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            <Link to="/#properties" aria-label="Search properties" className="grid size-10 place-items-center rounded-full text-slate-800 hover:bg-slate-100 lg:hidden"><Search className="size-6" aria-hidden /></Link>
            <button type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className="grid size-10 place-items-center rounded-full text-slate-800 hover:bg-slate-100 lg:hidden">
              {menuOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
            </button>
            <Link to="/sign-in" className="hidden rounded-full border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 lg:inline-flex">Sign in</Link>
            <Link to="/sign-up" className="hidden rounded-full bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 lg:inline-flex">Register</Link>
          </div>
        </div>
        {menuOpen && (
          <nav aria-label="Mobile menu" className="mx-auto grid w-full max-w-[1500px] gap-1 border-t border-slate-200 py-2 lg:hidden">
            <Link to="/about" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">About us</Link>
            {isHome
              ? <a href="https://wa.me/254799326074" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Help on WhatsApp</a>
              : <Link to="/sign-in" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Help & support</Link>}
            <div className="grid grid-cols-2 gap-2 px-2 py-1">
              <Link to="/sign-in" onClick={() => setMenuOpen(false)} className="rounded-full border border-emerald-700 px-3 py-2 text-center text-sm font-semibold text-emerald-900">Sign in</Link>
              <Link to="/sign-up" onClick={() => setMenuOpen(false)} className="rounded-full bg-emerald-600 px-3 py-2 text-center text-sm font-semibold text-white">Register</Link>
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full px-3 pb-8 pt-4 sm:px-6"><Outlet /></main>
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
