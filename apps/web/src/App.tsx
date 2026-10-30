import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Ambient } from "@/components/layout/Ambient";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { HouseLoader } from "@/components/motion/Doodles";
import { ComplaintsView } from "@/components/shared/ComplaintsView";
import { NoticesView } from "@/components/shared/NoticesView";
import { Notice } from "@/components/ui/Notice";
import { RequireRole } from "@/features/auth/guards";
import Browse from "@/pages/Browse";
import Privacy from "@/pages/Privacy";
import SignIn from "@/pages/SignIn";
import Terms from "@/pages/Terms";

// Each area loads only when it is opened, so a visitor browsing houses never downloads the dashboards.
const SignUp = lazy(() => import("@/pages/SignUp"));
const House = lazy(() => import("@/pages/House"));
const About = lazy(() => import("@/pages/About"));
const InviteAccept = lazy(() => import("@/pages/InviteAccept"));
const L = {
  Layout: lazy(() => import("@/pages/landlord/LandlordLayout")), Overview: lazy(() => import("@/pages/landlord/Overview")), Houses: lazy(() => import("@/pages/landlord/Houses")),
  Visits: lazy(() => import("@/pages/landlord/Visits")), Tenants: lazy(() => import("@/pages/landlord/Tenants")),
  Payments: lazy(() => import("@/pages/landlord/Payments")), Mpesa: lazy(() => import("@/pages/landlord/MpesaSetup")), Sms: lazy(() => import("@/pages/landlord/Sms")),
  Plan: lazy(() => import("@/pages/landlord/Plan")), More: lazy(() => import("@/pages/landlord/More")), Agreement: lazy(() => import("@/pages/landlord/AgreementPrint")),
};
const T = { Layout: lazy(() => import("@/pages/tenant/TenantLayout")), Pay: lazy(() => import("@/pages/tenant/Pay")), Documents: lazy(() => import("@/pages/tenant/Documents")) };
const A = {
  Layout: lazy(() => import("@/pages/admin/AdminLayout")), Overview: lazy(() => import("@/pages/admin/Overview")), Documents: lazy(() => import("@/pages/admin/Documents")),
  Subscriptions: lazy(() => import("@/pages/admin/Subscriptions")), Payments: lazy(() => import("@/pages/admin/Payments")),
  Payouts: lazy(() => import("@/pages/admin/Payouts")), Celcom: lazy(() => import("@/pages/admin/Celcom")),
};

const Missing = () => <><Ambient /><Notice icon="missing" title="Page not found" body="The page you are looking for does not exist." action={{ to: "/", label: "Back to houses" }} /></>;

export default function App() {
  return (
    <Suspense fallback={<HouseLoader />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Browse />} />
          <Route path="about" element={<About />} />
          <Route path="house/:id" element={<House />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
        </Route>
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />

        <Route path="/landlord" element={<RequireRole role="landlord"><L.Layout /></RequireRole>}>
          <Route index element={<L.Overview />} />
          <Route path="houses" element={<L.Houses />} />
          <Route path="visits" element={<L.Visits />} />
          <Route path="tenants" element={<L.Tenants />} />
          <Route path="payments" element={<L.Payments />} />
          <Route path="mpesa" element={<L.Mpesa />} />
          <Route path="sms" element={<L.Sms />} />
          <Route path="plan" element={<L.Plan />} />
          <Route path="complaints" element={<ComplaintsView role="landlord" />} />
          <Route path="notices" element={<NoticesView role="landlord" />} />
          <Route path="more" element={<L.More />} />
        </Route>
        <Route path="/landlord/agreement/:id" element={<RequireRole role="landlord"><L.Agreement /></RequireRole>} />

        <Route path="/tenant" element={<RequireRole role="tenant"><T.Layout /></RequireRole>}>
          <Route index element={<T.Pay />} />
          <Route path="complaints" element={<ComplaintsView role="tenant" />} />
          <Route path="documents" element={<T.Documents />} />
          <Route path="notices" element={<NoticesView role="tenant" />} />
        </Route>

        <Route path="/admin" element={<RequireRole role="admin"><A.Layout /></RequireRole>}>
          <Route index element={<A.Overview />} />
          <Route path="documents" element={<A.Documents />} />
          <Route path="subscriptions" element={<A.Subscriptions />} />
          <Route path="payments" element={<A.Payments />} />
          <Route path="payouts" element={<A.Payouts />} />
          <Route path="celcom" element={<A.Celcom />} />
        </Route>

        <Route path="/forbidden" element={<><Ambient /><Notice icon="forbidden" title="You do not have access" body="This page belongs to a different kind of account." action={{ to: "/", label: "Back to houses" }} /></>} />
        <Route path="*" element={<Missing />} />
      </Routes>
    </Suspense>
  );
}
