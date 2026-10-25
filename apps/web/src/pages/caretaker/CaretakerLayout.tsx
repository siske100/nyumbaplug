import { MessageCircleWarning, Users } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";

const items: NavItem[] = [
  { to: "/caretaker", label: "Complaints", icon: MessageCircleWarning, end: true },
  { to: "/caretaker/tenants", label: "Tenants", icon: Users },
];
export default function CaretakerLayout() { return <AppShell items={items} />; }
