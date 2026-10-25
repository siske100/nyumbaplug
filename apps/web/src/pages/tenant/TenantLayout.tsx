import { CreditCard, FileText, Megaphone, MessageCircleWarning } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";

const items: NavItem[] = [
  { to: "/tenant", label: "Pay", icon: CreditCard, end: true },
  { to: "/tenant/complaints", label: "Complaints", icon: MessageCircleWarning },
  { to: "/tenant/documents", label: "Documents", icon: FileText },
  { to: "/tenant/notices", label: "Notices", icon: Megaphone },
];
export default function TenantLayout() { return <AppShell items={items} />; }
