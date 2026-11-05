import { FileText, LayoutDashboard, LifeBuoy, Megaphone, MessageCircleWarning } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";

const items: NavItem[] = [
  { to: "/tenant", label: "Dashboard", headerLabel: "Tenant Dashboard", icon: LayoutDashboard, end: true },
  { to: "/tenant/complaints", label: "Complaints", icon: MessageCircleWarning },
  { to: "/tenant/documents", label: "Documents", icon: FileText },
  { to: "/tenant/notices", label: "Notices", icon: Megaphone },
  { to: "/tenant/support", label: "Help & support", icon: LifeBuoy },
];
export default function TenantLayout() { return <AppShell items={items} theme="tenant" />; }
