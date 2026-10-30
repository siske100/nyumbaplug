import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";

export default function About() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

  return (
    <div className="grid gap-6">
      <PageHead title="About Rental Houses Kenya" sub="Information about the service, who it is for, and why we ask for information." />

      <Panel id="about-rental-houses" className="grid scroll-mt-24 gap-3 p-5 sm:p-7">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-ember-300">About the service</p>
        <h2 className="text-3xl">Rental Houses Kenya</h2>
        <p className="max-w-3xl leading-7 text-graphite-200">
          A rental discovery and property-management platform operated by Referraliq Solutions. People can browse vacant rental listings across Kenya without signing in, compare rent and property details, and request a viewing. Landlords can publish available houses and manage viewing requests, tenants, rent records, notices and tenant SMS. Invited tenants can use their account areas to manage tenancy-related tasks.
        </p>
      </Panel>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel id="for-house-hunters" className="grid scroll-mt-24 content-start gap-2 p-5">
          <h2 className="text-xl">For house hunters</h2>
          <p className="text-sm leading-6 text-graphite-300">Browse by county and house type, review rent, amenities and vacancy information, then request a viewing. Provide your contact details and preferred time so the landlord can follow up with you.</p>
          <Link to="/" className="mt-1 text-sm text-ember-300 underline-offset-4 hover:underline">Browse available houses</Link>
        </Panel>
        <Panel id="for-landlords" className="grid scroll-mt-24 content-start gap-2 p-5">
          <h2 className="text-xl">For landlords</h2>
          <p className="text-sm leading-6 text-graphite-300">Create a landlord account, submit details for review, publish available houses, manage tenants and payment records, and choose whether rent goes to the platform Paybill or your own connected Paybill. Google sign-in uses basic Google account information to create or access your landlord account; it does not access Gmail, Drive or contacts.</p>
          <Link to="/sign-up" className="mt-1 text-sm text-ember-300 underline-offset-4 hover:underline">Create a landlord account</Link>
        </Panel>
        <Panel id="for-tenants" className="grid scroll-mt-24 content-start gap-2 p-5">
          <h2 className="text-xl">For tenants</h2>
          <p className="text-sm leading-6 text-graphite-300">Landlords invite tenants to access tenancy information, rent payments, documents, notices and complaints.</p>
        </Panel>
      </div>

      <Panel id="why-we-ask" className="grid scroll-mt-24 gap-3 p-5 sm:p-7">
        <h2 className="text-2xl">Why we ask for information</h2>
        <ul className="grid gap-2 text-sm leading-6 text-graphite-300">
          <li><strong className="text-bone">Sign-in details:</strong> your name and email identify your account; passwords or Google sign-in authenticate it. Google provides basic profile information for sign-in only.</li>
          <li><strong className="text-bone">Phone number:</strong> used to let landlords follow up on viewing requests, for account messages, and for landlord M-Pesa prompts or SMS features, as relevant to your role. Viewing-request numbers are not verified with a code.</li>
          <li><strong className="text-bone">Landlord identity and KRA documents:</strong> collected to review landlord eligibility and help protect rental listings from fraudulent accounts.</li>
          <li><strong className="text-bone">Viewing request details:</strong> your name, phone number, selected house and preferred time are shared with the relevant landlord so they can contact you and arrange the viewing. Your number is not verified with a code.</li>
          <li><strong className="text-bone">Payment and message records:</strong> used to confirm and reconcile M-Pesa transactions, maintain rent records, send requested SMS and track delivery. We do not ask for or store your M-Pesa PIN.</li>
        </ul>
        <p className="text-sm leading-6 text-graphite-300">
          We do not sell personal information. Access to private account information is limited by role. Read the <Link to="/privacy" className="text-ember-300 underline underline-offset-4 hover:text-bone">Privacy Policy</Link> for details about collection, use, service providers, retention and privacy requests, or contact <a href="mailto:siskemejja@gmail.com" className="text-ember-300 underline underline-offset-4 hover:text-bone">siskemejja@gmail.com</a>.
        </p>
      </Panel>
    </div>
  );
}
