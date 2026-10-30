import { Home, LogOut, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useSession, useSignOut } from "@/features/auth/useSession";
import { cn } from "@/lib/cn";
import { Ambient } from "./Ambient";

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number; mobileOnly?: boolean }

export function AppShell({ items, railFooter, mobile, fullWidth = false }: { items: NavItem[]; railFooter?: ReactNode; mobile?: string[]; fullWidth?: boolean }) {
  const { data: session } = useSession();
  const signOut = useSignOut();

  return (
    <>
      <Ambient />
      <div className={cn("mx-auto grid gap-4 p-3 md:grid-cols-[15rem_minmax(0,1fr)] md:p-5", fullWidth ? "w-full" : "max-w-7xl")}>
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

        <div className="min-w-0 pb-24 md:pb-0">
          <div className="mb-4 flex justify-end md:hidden">
            <button onClick={() => signOut.mutate()} className="glass-quiet flex items-center gap-2 px-3 py-2 text-sm text-graphite-200"><LogOut className="size-4" aria-hidden />Sign out</button>
          </div>
          <p className="sr-only">Signed in as {session?.name}</p>
          <Outlet />
        </div>
      </div>

      <nav aria-label="Main" className="glass fixed inset-x-3 bottom-3 z-20 flex justify-around rounded-2xl p-1.5 md:hidden" style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}>
        {items.filter((i) => !mobile || mobile.includes(i.to)).map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-xs", isActive ? "bg-white/10 text-ember-300" : "text-graphite-300")}>
            <span className="relative"><Icon className="size-5" aria-hidden />{!!badge && <span className="absolute -right-2 -top-1 size-2 rounded-full bg-ember-400" />}</span>{label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
