import { Banknote, CalendarDays, CreditCard, FileCheck2, LayoutGrid, MessageSquare, Receipt } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";
import { useAdminKyc } from "@/features/admin/hooks";

export default function AdminLayout() {
  const kyc = useAdminKyc();
  const items: NavItem[] = [
    { to: "/admin", label: "Dashboard", icon: LayoutGrid, end: true, headerLabel: "Admin Dashboard" },
    { to: "/admin/subscriptions", label: "Plans", icon: CreditCard },
    { to: "/admin/bookings", label: "Bookings", icon: CalendarDays },
    { to: "/admin/payments", label: "Payments", icon: Receipt },
    { to: "/admin/documents", label: "Documents", icon: FileCheck2, badge: kyc.data?.length },
    { to: "/admin/payouts", label: "Payouts", icon: Banknote },
    { to: "/admin/celcom", label: "Celcom", icon: MessageSquare },
  ];
  return <AppShell items={items} />;
}
