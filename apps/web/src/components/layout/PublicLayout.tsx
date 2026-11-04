import { Link, Outlet } from "react-router-dom";
import { Ambient } from "./Ambient";

export function PublicLayout() {
  return (
    <>
      <Ambient />
      <header className="sticky top-0 z-20 px-3 pt-3 sm:px-6">
        <div className="glass mx-auto flex w-full items-center justify-between rounded-2xl px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/houseplug-kenya-wordmark.png" alt="HousePlug Kenya — Find, Book, Manage" className="h-auto w-32 rounded-md bg-white sm:w-40" />
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/sign-in" className="rounded-[10px] bg-white/8 px-3 py-2 text-sm text-bone hover:bg-white/12">Sign in</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full px-3 pb-16 pt-6 sm:px-6"><Outlet /></main>
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
          <nav aria-label="Contact" className="grid content-start gap-3">
            <span className="font-medium text-bone">Call or WhatsApp</span>
            <a href="tel:+254799326074" className="w-fit hover:text-bone">0799326074</a>
            <a href="https://wa.me/254799326074" className="w-fit hover:text-bone" target="_blank" rel="noreferrer">Message us on WhatsApp</a>
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
