import { Link } from "react-router-dom";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";

const sections = [
  {
    title: "About the service",
    content: <>
      <p>Rental Houses Kenya is operated by Referraliq Solutions. The platform helps landlords publish rental listings and manage property-related workflows, and helps prospective tenants discover listings and request viewings.</p>
      <p>The platform is a technology service. Unless a separate written agreement says otherwise, it is not a party to a tenancy, does not own or inspect listed properties, and does not guarantee that a listing, landlord, tenant, viewing or payment arrangement is suitable or accurate.</p>
    </>,
  },
  {
    title: "Accounts and eligibility",
    content: <>
      <p>You must provide accurate information, be legally able to use the service, keep your sign-in details secure and promptly tell us about suspected account misuse. Do not impersonate another person or create an account for someone without authority.</p>
      <p>Landlord accounts may require email confirmation, contact details, identity and KRA documents, administrator approval and payment of the applicable subscription before listings become active. Google sign-in creates a landlord account; it does not bypass verification, approval or payment requirements. Tenants and caretakers access accounts through landlord invitations and applicable verification steps.</p>
    </>,
  },
  {
    title: "Landlord listings and user content",
    content: <>
      <p>Landlords must have authority to advertise a property and must keep listing details, location, rent, deposit, amenities, photos and availability accurate and lawful. Do not post information or images you do not have the right to use, personal information without a lawful basis, misleading claims, or content that is unlawful or discriminatory.</p>
      <p>You retain rights in content you submit. You give Referraliq Solutions a limited, non-exclusive permission to host, display, resize and use that content as needed to operate, secure and promote the service and the relevant listing. You can remove or update listings through available account tools, subject to records that must be retained.</p>
    </>,
  },
  {
    title: "Viewings, tenancies and communications",
    content: <>
      <p>A viewing request is not a reservation, tenancy agreement or guarantee that a property will remain available. Landlords and prospective tenants are responsible for confirming details, arranging viewings, exercising reasonable care and deciding whether to enter into a tenancy.</p>
      <p>Platform notices, reminders and SMS depend on accurate contact details, available balance, network coverage and third-party provider availability. We do not guarantee that a message will arrive immediately or be read. Do not rely on an SMS as the sole record of a rent payment or important legal notice.</p>
    </>,
  },
  {
    title: "Payments, subscriptions and SMS credit",
    content: <>
      <p>Payments are processed or recorded through the configured M-Pesa Daraja flows. Depending on the landlord's chosen setup, rent may be paid to the platform Paybill and later paid out by the platform, or paid directly to the landlord's own Paybill. Where rent is received by the platform, payouts may be processed manually and can take time to reconcile. Check the payment status and contact support if a payment is not reflected.</p>
      <p>Landlord subscriptions and SMS-wallet recharges are separate platform purchases. Subscription prices and SMS segment prices are shown in the service before payment and may change for future purchases with notice. SMS wallet balances are prepaid credits for eligible platform messages, not cash withdrawable from the wallet. Where a provider rejects a charged message, the system may refund the corresponding wallet charge as shown in the product.</p>
      <p>Except where required by law or stated in the service, completed digital purchases are not refundable merely because you change your mind. This does not limit rights that cannot lawfully be excluded.</p>
    </>,
  },
  {
    title: "Acceptable use and suspension",
    content: <>
      <p>You must not misuse the service, interfere with its security or operation, access another person's account or information, send unlawful or abusive messages, evade payment or access controls, upload malicious content, or use the platform to facilitate fraud or unlawful discrimination.</p>
      <p>We may limit, suspend or close access where reasonably necessary to protect users or the service, investigate suspected misuse, address a legal or security risk, or enforce these terms. Where appropriate, we will provide notice and an opportunity to resolve the issue. Suspension may hide listings or pause account access as described in the service.</p>
    </>,
  },
  {
    title: "Third-party services and availability",
    content: <>
      <p>The platform relies on third parties. Their services are subject to their own terms and may be unavailable or change. We are not responsible for third-party systems beyond our reasonable control.</p>
      <p>We aim to keep the service available and secure, but do not promise uninterrupted or error-free operation. Features may be changed, paused or discontinued, with reasonable notice where practicable.</p>
    </>,
  },
  {
    title: "Liability, changes and governing law",
    content: <>
      <p>To the extent permitted by law, Referraliq Solutions is not liable for indirect or consequential loss, loss caused by inaccurate user-supplied listing information, or a third party's network or payment service. Nothing in these terms excludes liability or consumer rights that cannot legally be excluded or limited.</p>
      <p>We may update these terms by publishing a revised version with a new effective date. Continued use after the effective date means you accept the revised terms to the extent permitted by law. These terms are governed by the laws of Kenya, and disputes are subject to the jurisdiction of Kenyan courts, subject to any mandatory consumer protections.</p>
      <p>Questions or complaints: <a className="underline underline-offset-4 hover:text-bone" href="mailto:siskemejja@gmail.com">siskemejja@gmail.com</a>.</p>
    </>,
  },
];

export default function Terms() {
  return (
    <article className="mx-auto grid max-w-4xl gap-5">
      <PageHead title="Terms of Service" sub="Rules for using Rental Houses Kenya." />
      <p className="text-sm text-graphite-400">Effective date: 25 October 2026. This draft should be reviewed by a Kenyan lawyer before production use.</p>
      {sections.map((section) => (
        <Panel key={section.title} className="grid gap-3 p-5 sm:p-6">
          <h2 className="text-xl">{section.title}</h2>
          <div className="grid gap-3 text-sm leading-6 text-graphite-300">{section.content}</div>
        </Panel>
      ))}
      <p className="text-sm text-graphite-400"><Link to="/privacy" className="underline underline-offset-4 hover:text-bone">Read the Privacy Policy</Link>.</p>
    </article>
  );
}
