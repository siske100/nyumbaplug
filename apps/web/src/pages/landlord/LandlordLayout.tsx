import { Building2, CalendarDays, CreditCard, Grid2x2, LayoutGrid, LifeBuoy, Users } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";

export const LANDLORD_NAV: NavItem[] = [
  { to: "/landlord", label: "Dashboard", mobileLabel: "Dashboard", headerLabel: "Landlord Dashboard", icon: LayoutGrid, end: true },
  { to: "/landlord/houses", label: "My properties", mobileLabel: "Properties", icon: Building2 },
  { to: "/landlord/visits", label: "View bookings", mobileLabel: "Bookings", icon: CalendarDays },
  { to: "/landlord/tenants", label: "Tenants", icon: Users },
  { to: "/landlord/finances", label: "Payments", mobileLabel: "Payments", icon: CreditCard },
  { to: "/landlord/plan", label: "Subscription", icon: CreditCard },
  { to: "/landlord/support", label: "Help & support", icon: LifeBuoy },
  { to: "/landlord/more", label: "More", icon: Grid2x2 },
];
export default function LandlordLayout() { return <AppShell items={LANDLORD_NAV} theme="landlord" />; }
