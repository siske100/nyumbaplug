import { Home } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { Ambient } from "./Ambient";

export function PublicLayout() {
  return (
    <>
      <Ambient />
      <header className="sticky top-0 z-20 px-3 pt-3 sm:px-6">
        <div className="glass mx-auto flex max-w-6xl items-center justify-between rounded-2xl px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-ember-500 text-graphite-950"><Home className="size-4.5" aria-hidden /></span>
            <span className="font-display text-lg">Rental Houses Kenya</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/sign-up" className="rounded-[10px] px-3 py-2 text-sm text-graphite-200 hover:bg-white/8 hover:text-bone">For landlords</Link>
            <Link to="/sign-in" className="rounded-[10px] bg-white/8 px-3 py-2 text-sm text-bone hover:bg-white/12">Sign in</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 pb-16 pt-6 sm:px-6"><Outlet /></main>
    </>
  );
}
