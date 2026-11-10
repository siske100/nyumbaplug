import { Bell, ChevronDown, Crown, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession, useSignOut } from "@/features/auth/useSession";
import { cn } from "@/lib/cn";
import { Ambient } from "./Ambient";

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number; mobileOnly?: boolean; headerLabel?: string }

export function AppShell({ items, railFooter, children, theme = "default" }: { items: NavItem[]; railFooter?: ReactNode; children?: ReactNode; theme?: "default" | "landlord" | "tenant" }) {
  const { data: session } = useSession();
  const signOut = useSignOut();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const currentItem = items.find((item) => {
    const [path, hash] = item.to.split("#");
    return !!hash && location.pathname === path && location.hash === `#${hash}`;
  }) ?? items.find((item) => {
    const [path, hash] = item.to.split("#");
    const [pathname, query] = path!.split("?");
    return !hash && location.pathname === pathname && (!query || location.search === `?${query}`);
  });
  const pageTitle = currentItem?.headerLabel ?? currentItem?.label ?? "Dashboard";
  const initials = session?.name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "HP";
  const isCurrent = (item: NavItem) => {
    const [path, hash] = item.to.split("#");
    const [pathname, query] = path!.split("?");
    return location.pathname === pathname
      && (hash ? location.hash === `#${hash}` : !items.some((candidate) => candidate.to.startsWith(`${path}#`)) || !location.hash)
      && (!query || location.search === `?${query}`);
  };
  const navClass = (item: NavItem) => cn(
    "flex items-center rounded-[10px] transition-colors",
    theme === "landlord" || theme === "tenant" ? "gap-2 px-2 py-2 text-xs whitespace-nowrap" : "gap-3 px-3 py-2.5 text-sm",
    isCurrent(item) ? "dashboard-nav-active" : "dashboard-nav-idle",
  );

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [location.pathname, location.hash]);

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
    <div className="dashboard-shell min-h-dvh" data-dashboard-theme={theme}>
      <Ambient />
      <div className="mx-auto grid min-h-dvh w-full max-w-[1800px] md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="dashboard-sidebar hidden h-dvh flex-col p-2.5 md:sticky md:top-0 md:flex">
          <div className="dashboard-brand mb-5 flex items-center gap-2 px-1">
            <img src="/houseplug-kenya-wordmark.png" alt="HousePlug Kenya — Find, Book, Manage" className="dashboard-brand-logo h-auto w-full rounded-md bg-white" />
          </div>
          <nav aria-label="Main" className="grid gap-1">
            {items.filter((i) => !i.mobileOnly).map((item) => {
              const { to, label, icon: Icon, badge } = item;
              return <NavLink key={to} to={to} end={!to.includes("#")} className={() => navClass(item)}>
                <Icon className={theme === "landlord" ? "size-4 shrink-0" : "size-4.5 shrink-0"} aria-hidden />{label}{!!badge && <span className="ml-auto rounded-full bg-emerald-400/20 px-2 text-xs text-emerald-100">{badge}</span>}
              </NavLink>
            })}
          </nav>
          <div className="mt-auto grid gap-2.5">
            {theme === "landlord" ? (
              <>
                <div className="dashboard-landlord-upgrade rounded-xl p-2.5">
                  <Crown className="mb-1 size-5 text-emerald-300" aria-hidden />
                  <p className="text-[11px] font-bold text-white">Premium Landlord</p>
                  <p className="mt-0.5 text-[10px] leading-4 text-emerald-100">{railFooter ? "Renew soon to keep your account active." : "Your landlord plan"}</p>
                  <Link to="/landlord/plan" className="mt-2 block rounded-md bg-emerald-300 px-2 py-1.5 text-center text-[10px] font-extrabold text-emerald-950 hover:bg-emerald-200">Upgrade Plan</Link>
                </div>
                <div className="dashboard-landlord-city rounded-lg" role="img" aria-label="Apartment buildings at dusk" />
              </>
            ) : <div className="dashboard-sidebar-promo rounded-xl p-3.5">
              <p className="text-xs font-semibold text-white">HousePlug Kenya</p>
              <p className="mt-1 text-[11px] leading-4 text-emerald-100/80">{theme === "tenant" ? "Manage your tenancy and rent payments." : "Find, book, and manage homes in one place."}</p>
            </div>}
            {theme !== "landlord" && railFooter}
            <button onClick={() => signOut.mutate()} className="dashboard-nav-idle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm">
              <LogOut className="size-4.5" aria-hidden />Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="dashboard-topbar sticky top-0 z-20 flex h-[4.5rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" className="dashboard-menu-button grid size-10 shrink-0 place-items-center rounded-xl md:hidden" aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>
                {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
                <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
              </button>
              {theme === "landlord" && location.pathname === "/landlord" ? (
                <>
                  <img src="/houseplug-kenya-wordmark.png" alt="HousePlug Kenya — Find, Book, Manage" className="h-auto w-32 rounded-md bg-white px-1 py-0.5 md:hidden" />
                  <div className="hidden min-w-0 md:block">
                    <h1 className="truncate text-lg font-bold text-slate-900">{pageTitle}</h1>
                    <p className="text-xs text-slate-500">HousePlug Kenya · Property management</p>
                  </div>
                </>
              ) : (
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-bold text-slate-900">{pageTitle}</h1>
                  <p className="hidden text-xs text-slate-500 sm:block">HousePlug Kenya · Property management</p>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button type="button" className="dashboard-icon-button relative grid size-10 place-items-center rounded-full" aria-label="Notifications">
                <Bell className="size-5" aria-hidden />
              </button>
              <div className="flex items-center gap-2">
                <span className="dashboard-avatar grid size-9 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">{initials}</span>
                <span className="hidden max-w-36 truncate text-sm font-semibold text-slate-700 sm:block">{session?.name ?? "Account"}</span>
                <ChevronDown className="hidden size-4 text-slate-500 sm:block" aria-hidden />
              </div>
            </div>
          </header>
          <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8">
            <p className="sr-only">Signed in as {session?.name}</p>
            {children ?? <Outlet />}
          </main>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button type="button" className="absolute inset-0 size-full bg-black/60" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)} />
          <aside id="mobile-navigation" className="dashboard-sidebar fixed bottom-0 left-0 top-0 flex h-dvh w-[min(18rem,85vw)] flex-col overflow-y-auto rounded-none rounded-r-2xl p-4 shadow-2xl" aria-label="Mobile navigation">
            <div className="mb-7 flex items-center justify-between gap-2.5 px-1">
              <div className="flex items-center gap-2.5">
                <img src="/houseplug-kenya-wordmark.png" alt="HousePlug Kenya — Find, Book, Manage" className="dashboard-brand-logo h-auto w-40 rounded-md bg-white" />
              </div>
              <button type="button" className="dashboard-nav-idle rounded-lg p-2" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)}><X className="size-5" aria-hidden /></button>
            </div>
            <nav aria-label="Main" className="grid gap-1">
              {items.filter((i) => !i.mobileOnly).map((item) => {
                const { to, label, icon: Icon, badge } = item;
                return <NavLink key={to} to={to} end={!to.includes("#")} onClick={() => setMenuOpen(false)} className={() => navClass(item)}>
                  <Icon className="size-4.5" aria-hidden />{label}{!!badge && <span className="ml-auto rounded-full bg-emerald-400/20 px-2 text-xs text-emerald-100">{badge}</span>}
                </NavLink>
              })}
            </nav>
            <div className="mt-auto grid gap-3 pt-6">
              <div className="dashboard-sidebar-promo rounded-xl p-3.5">
                <p className="text-xs font-semibold text-white">Kenya&apos;s Property Marketplace</p>
                <p className="mt-1 text-[11px] leading-4 text-emerald-100/80">Find, book, and manage homes in one place.</p>
              </div>
              {railFooter}
              <button onClick={() => { setMenuOpen(false); signOut.mutate(); }} className="dashboard-nav-idle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm">
                <LogOut className="size-4.5" aria-hidden />Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
