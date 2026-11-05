import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { CalendarDays, CircleHelp, House, Info, Menu, Search, UserRound, X } from "lucide-react";
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
          <Link to="/" className="flex items-center gap-2.5">
            <span className="relative block size-12 shrink-0 overflow-hidden lg:size-10" aria-hidden="true">
              <img src="/houseplug-kenya-mark.png" alt="" className="absolute -left-px -top-px w-[50px] max-w-none lg:w-[42px]" />
            </span>
            <span className="grid text-sm font-extrabold leading-tight sm:text-base">
              <span className="text-rose-900">HousePlug</span>
              <span className="text-emerald-700">Kenya</span>
            </span>
            <span className="sr-only">HousePlug Kenya — Find, Book, Manage</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            <Link to="/" className="inline-flex items-center gap-2 rounded-lg bg-rose-900 px-3 py-2 text-sm font-semibold text-white"><House className="size-4" aria-hidden />Home</Link>
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
            <Link to="/sign-in" className="hidden rounded-full border border-rose-800 px-3 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-50 lg:inline-flex">Sign in</Link>
            <Link to="/sign-up" className="hidden rounded-full bg-rose-900 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-800 lg:inline-flex">Register</Link>
          </div>
        </div>
        {menuOpen && (
          <nav aria-label="Mobile menu" className="mx-auto grid w-full max-w-[1500px] gap-1 border-t border-slate-200 py-2 lg:hidden">
            <Link to="/about" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">About us</Link>
            {isHome
              ? <a href="https://wa.me/254799326074" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Help on WhatsApp</a>
              : <Link to="/sign-in" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Help & support</Link>}
            <div className="grid grid-cols-2 gap-2 px-2 py-1">
              <Link to="/sign-in" onClick={() => setMenuOpen(false)} className="rounded-full border border-rose-800 px-3 py-2 text-center text-sm font-semibold text-rose-900">Sign in</Link>
              <Link to="/sign-up" onClick={() => setMenuOpen(false)} className="rounded-full bg-rose-900 px-3 py-2 text-center text-sm font-semibold text-white">Register</Link>
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full px-3 pb-20 pt-4 sm:px-6 lg:pb-16"><Outlet /></main>
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-4px_18px_rgb(15_23_42_/_0.08)] backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <Link to="/" aria-current={isHome && !location.hash ? "page" : undefined} className={`grid min-h-12 place-items-center gap-0.5 text-xs font-semibold ${isHome && !location.hash ? "text-rose-900" : "text-slate-600"}`}>
          <House className="size-6" aria-hidden />Home
        </Link>
        <Link to="/#properties" aria-current={location.hash === "#properties" ? "page" : undefined} className={`grid min-h-12 place-items-center gap-0.5 text-xs font-semibold ${location.hash === "#properties" ? "text-rose-900" : "text-slate-600"}`}>
          <Search className="size-6" aria-hidden />Search
        </Link>
        <Link to="/sign-in" className="grid min-h-12 place-items-center gap-0.5 text-xs font-semibold text-slate-600">
          <CalendarDays className="size-6" aria-hidden />Bookings
        </Link>
        <Link to="/sign-in" className="grid min-h-12 place-items-center gap-0.5 text-xs font-semibold text-slate-600">
          <UserRound className="size-6" aria-hidden />Account
        </Link>
      </nav>
      <footer className="mx-auto grid w-full gap-8 px-3 pb-24 text-sm text-graphite-400 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:pb-8">
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
