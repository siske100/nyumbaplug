import { Home, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useSession, useSignOut } from "@/features/auth/useSession";
import { cn } from "@/lib/cn";
import { Ambient } from "./Ambient";

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number; mobileOnly?: boolean }

export function AppShell({ items, railFooter }: { items: NavItem[]; railFooter?: ReactNode }) {
  const { data: session } = useSession();
  const signOut = useSignOut();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (signOut.isPending) return;

    let timeout: number;
    const resetIdleTimeout = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => signOut.mutate(), 60_000);
    };
    const activityEvents = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"];
    activityEvents.forEach((event) => window.addEventListener(event, resetIdleTimeout, { passive: true }));
    resetIdleTimeout();

    return () => {
      window.clearTimeout(timeout);
      activityEvents.forEach((event) => window.removeEventListener(event, resetIdleTimeout));
    };
  }, [signOut.isPending, signOut.mutate]);

  return (
    <>
      <Ambient />
      <div className="mx-auto grid w-full gap-4 p-3 md:grid-cols-[15rem_minmax(0,1fr)] md:p-5">
        <aside className="glass hidden h-[calc(100dvh-2.5rem)] flex-col rounded-2xl p-4 md:sticky md:top-5 md:flex">
          <div className="mb-6 flex items-center gap-2.5 px-1">
            <span className="grid size-8 place-items-center rounded-lg bg-ember-500 text-graphite-950"><Home className="size-4.5" aria-hidden /></span>
            <span className="font-display text-lg">Rental Houses</span>
          </div>
          <nav aria-label="Main" className="grid gap-1">
            {items.filter((i) => !i.mobileOnly).map(({ to, label, icon: Icon, end, badge }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[0.95rem] transition-colors", isActive ? "bg-white/10 text-bone" : "text-graphite-200 hover:bg-white/6")}>
                <Icon className="size-4.5" aria-hidden />{label}{!!badge && <span className="ml-auto rounded-full bg-ember-500/20 px-2 text-xs text-ember-300">{badge}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto grid gap-3">
            {railFooter}
            <button onClick={() => signOut.mutate()} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-graphite-200 hover:bg-white/6">
              <LogOut className="size-4.5" aria-hidden />Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <p className="sr-only">Signed in as {session?.name}</p>
          <Outlet />
        </div>
      </div>

      <button type="button" className="glass-quiet fixed left-3 top-3 z-50 flex items-center gap-2 px-3 py-2 text-sm text-graphite-200 md:hidden" aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>
        {menuOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
        {menuOpen ? "Close menu" : "Menu"}
      </button>

      {menuOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button type="button" className="absolute inset-0 size-full bg-black/60" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)} />
          <aside id="mobile-navigation" className="glass absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col overflow-y-auto rounded-none rounded-r-2xl p-4 pt-16 shadow-2xl" style={{ background: "rgb(13 13 15 / 0.95)" }} aria-label="Mobile navigation">
            <div className="mb-6 flex items-center justify-between gap-2.5 px-1">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-ember-500 text-graphite-950"><Home className="size-4.5" aria-hidden /></span>
                <span className="font-display text-lg">Rental Houses</span>
              </div>
              <button type="button" className="rounded-lg p-2 text-graphite-200 hover:bg-white/8" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)}><X className="size-5" aria-hidden /></button>
            </div>
            <nav aria-label="Main" className="grid gap-1">
              {items.filter((i) => !i.mobileOnly).map(({ to, label, icon: Icon, end, badge }) => (
                <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn("flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[0.95rem] transition-colors", isActive ? "bg-white/10 text-bone" : "text-graphite-200 hover:bg-white/6")}>
                  <Icon className="size-4.5" aria-hidden />{label}{!!badge && <span className="ml-auto rounded-full bg-ember-500/20 px-2 text-xs text-ember-300">{badge}</span>}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto grid gap-3 pt-6">
              {railFooter}
              <button onClick={() => { setMenuOpen(false); signOut.mutate(); }} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-graphite-200 hover:bg-white/6">
                <LogOut className="size-4.5" aria-hidden />Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
