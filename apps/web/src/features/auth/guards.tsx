import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { LandlordState, Role } from "@/api/types";
import { HouseLoader } from "@/components/motion/Doodles";
import { Notice } from "@/components/ui/Notice";
import { AdminMfa } from "@/pages/admin/Mfa";
import { PhoneGate } from "@/pages/PhoneGate";
import { Onboarding } from "@/pages/landlord/onboarding/Onboarding";
import { useSession } from "./useSession";

const GATE_COPY: Partial<Record<LandlordState, { title: string; body: string }>> = {
  expired: { title: "Your subscription has expired", body: "Call customer care on 0799326074 to reactivate your account." },
  suspended: { title: "Your account is suspended", body: "Call customer care on 0799326074 to resume your account." },
};

/**
 * This guard only decides what to show. The server and database enforce the same rules on every request,
 * so skipping this component in the browser gains an attacker nothing.
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <HouseLoader />;
  if (!session) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  if (session.role !== role) return <Navigate to="/forbidden" replace />;

  if (role === "admin" && session.mfa && session.mfa !== "ok") return <AdminMfa />;
  if (role === "landlord" && session.landlordState && session.landlordState !== "active") {
    const c = GATE_COPY[session.landlordState];
    if (!c) return <Onboarding session={session} />;
    return <Notice icon="lock" title={c.title} body={c.body} />;
  }
  if (role === "tenant" && session.phoneVerified === false) return <PhoneGate session={session} />;
  if (role !== "landlord" && role !== "admin" && session.landlordOnHold) {
    return <Notice icon="lock" title="Your account is on hold" body="Please contact your landlord. Your records are kept safe." />;
  }
  return <>{children}</>;
}
