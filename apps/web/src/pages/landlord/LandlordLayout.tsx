import { Building2, CalendarDays, CreditCard, Grid2x2, LayoutGrid, MessageCircleWarning, MessageSquare, Megaphone, Receipt, Smartphone, Users } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { useLandlordSummary } from "@/features/landlord/hooks";
import { useLive } from "@/features/live";
import { api } from "@/api";
import { plural } from "@/lib/format";
import { useLocation, useNavigate } from "react-router-dom";

export const LANDLORD_NAV: NavItem[] = [
  { to: "/landlord", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/landlord/houses", label: "Houses", icon: Building2 },
  { to: "/landlord/visits", label: "Viewings", icon: CalendarDays },
  { to: "/landlord/tenants", label: "Tenants", icon: Users },
  { to: "/landlord/payments", label: "Payments", icon: Receipt },
  { to: "/landlord/mpesa", label: "M-Pesa setup", icon: Smartphone },
  { to: "/landlord/sms", label: "SMS", icon: MessageSquare },
  { to: "/landlord/plan", label: "Plan", icon: CreditCard },
  { to: "/landlord/complaints", label: "Complaints", icon: MessageCircleWarning },
  { to: "/landlord/notices", label: "Notices", icon: Megaphone },
  { to: "/landlord/more", label: "More", icon: Grid2x2, mobileOnly: true },
];
const MOBILE = ["/landlord", "/landlord/houses", "/landlord/tenants", "/landlord/payments", "/landlord/more"];

export default function LandlordLayout() {
  const { data } = useLandlordSummary();
  const complaints = useLive("landlord", "complaints", () => api.landlord.complaints());
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = LANDLORD_NAV.map((i) => (i.to === "/landlord/complaints" ? { ...i, badge: complaints.data?.filter((c) => c.status === "open").length } : i));
  const renew = data && data.subscriptionDaysLeft <= 7 && (
    <div className="glass-quiet border-ember-500/30 p-3.5">
      <p className="text-sm font-semibold">{plural(data.subscriptionDaysLeft, "day")} left</p>
      <p className="mb-3 mt-0.5 text-sm text-graphite-300">Renew to keep your account active.</p>
      <Button size="sm" className="w-full" onClick={() => navigate("/landlord/plan")}>Renew</Button>
    </div>
  );
  return <AppShell items={items} railFooter={renew} mobile={MOBILE} fullWidth={pathname === "/landlord/visits"} />;
}
