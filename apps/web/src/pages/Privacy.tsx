import { Link } from "react-router-dom";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";

const sections = [
  {
    title: "Information we collect",
    content: <>
      <p>Depending on how you use the service, we may process:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Account details such as your name, email address, phone number, account role and sign-in information. If you choose Google sign-in, Google provides basic account information to authenticate you.</li>
        <li>Landlord and property information, including listing details, rent and deposit amounts, unit availability, amenities, house rules, photos, and information needed to verify a landlord.</li>
        <li>Tenant, caretaker and viewing-request information, such as names, phone numbers, tenancy details, viewing preferences, messages, complaints and notices.</li>
        <li>Payment and service records, including rent ledger entries, M-Pesa references, subscription and SMS-wallet transactions, message delivery status, and SMS content needed to send or display messages.</li>
        <li>Information you provide in uploaded verification documents, such as identification and KRA documents.</li>
        <li>Technical information needed to operate and protect the service, such as authentication sessions, security events and basic device or browser information.</li>
      </ul>
    </>,
  },
  {
    title: "How we use information",
    content: <>
      <p>We use personal information to create and secure accounts; verify landlords; publish and manage rental listings; arrange viewing requests; administer tenancies, notices and complaints; process or record payments; send requested verification codes, receipts and reminders; provide customer support; prevent misuse; and meet applicable legal obligations.</p>
      <p>We rely on the steps needed to provide the service or fulfil a contract, legal obligations, legitimate interests such as protecting accounts and preventing fraud, and consent where applicable. You may withdraw consent where processing relies on it, without affecting processing already carried out.</p>
    </>,
  },
  {
    title: "Listings and who can see information",
    content: <>
      <p>Vacant property listings are public. They include property and location details, prices, amenities and listing photos, but are designed not to show a landlord's phone number, email address or the exact property location publicly. Viewing requests provide the information you submit to the platform and the relevant landlord so the viewing can be arranged.</p>
      <p>Information in private account areas is made available according to the person's role. For example, landlords can access information about their own properties and tenancies; tenants can access information about their own tenancy; and assigned caretakers receive limited operational access. Authorized administrators may access information needed for platform administration, verification, support and compliance.</p>
    </>,
  },

  {
    title: "Payments and messages",
    content: <>
      <p>M-Pesa payments are handled through Safaricom and the configured Paybill flow. The platform stores records needed to reconcile payments and manage landlord balances; it does not store your M-Pesa PIN. Depending on the landlord's setup, rent may go to the platform Paybill for later payout or directly to the landlord's own Paybill.</p>
      <p>SMS are sent through the configured SMS provider. We process the destination phone number, message text and delivery information to send and track requested messages. Messages sent from a landlord's wallet are also recorded against that landlord's SMS balance.</p>
    </>,
  },
  {
    title: "Storage, security and retention",
    content: <>
      <p>We use access controls, role-based database rules, private storage for verification documents, and encryption for saved landlord payment credentials. Photos may be resized and stripped of embedded location metadata before upload. No online service can guarantee absolute security, so please protect your account credentials and contact us if you suspect unauthorized access.</p>
      <p>We keep information for as long as needed to provide the service, maintain account and financial records, resolve disputes, enforce our terms and meet legal obligations. Retention periods vary by information type and applicable law; contact us to ask about a particular record. Some transaction or audit records may need to be retained even after an account is closed.</p>
    </>,
  },
  {
    title: "Your choices and rights",
    content: <>
      <p>Subject to applicable law, you may request access to or correction of your personal information, ask about its use, object to or request restriction of certain processing, request deletion where applicable, request a copy of information you provided, or withdraw consent where consent is the basis for processing. Some requests may be limited where information must be retained for legal, safety or financial-record reasons.</p>
      <p>To make a privacy request, contact <a className="underline underline-offset-4 hover:text-bone" href="mailto:siskemejja@gmail.com">siskemejja@gmail.com</a>. You may also complain to the Office of the Data Protection Commissioner in Kenya.</p>
    </>,
  },
  {
    title: "Children, changes and contact",
    content: <>
      <p>The platform is intended for adults arranging or managing rental housing, not for children to use independently. We may update this policy as the service or legal requirements change. The latest version will be published on this page with its effective date.</p>
      <p>Privacy contact: Referraliq Solutions, at <a className="underline underline-offset-4 hover:text-bone" href="mailto:siskemejja@gmail.com">siskemejja@gmail.com</a>.</p>
    </>,
  },
];

export default function Privacy() {
  return (
    <article className="mx-auto grid max-w-4xl gap-5">
      <PageHead title="Privacy Policy" sub="How Rental Houses Kenya collects, uses and protects personal information." />
      <p className="text-sm text-graphite-400">Effective date: 25 October 2026. This draft should be reviewed by a Kenyan privacy professional before production use.</p>
      {sections.map((section) => (
        <Panel key={section.title} className="grid gap-3 p-5 sm:p-6">
          <h2 className="text-xl">{section.title}</h2>
          <div className="grid gap-3 text-sm leading-6 text-graphite-300">{section.content}</div>
        </Panel>
      ))}
      <p className="text-sm text-graphite-400"><Link to="/terms" className="underline underline-offset-4 hover:text-bone">Read the Terms of Service</Link>.</p>
    </article>
  );
}
