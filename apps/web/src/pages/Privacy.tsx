import { Link } from "react-router-dom";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";

const sections = [
  {
    title: "Information we collect and where it comes from",
    content: <>
      <p>Referraliq Solutions operates Rental Houses Kenya. This policy applies to the public website and landlord, tenant, caretaker and administrator accounts. We collect information you enter, information generated when you use platform features, and limited information returned by sign-in and service providers.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Account and identity data:</strong> name, email address, phone number, account role and status, password authentication data managed by Supabase Auth, email and phone verification status, and authenticator-factor status for administrator accounts.</li>
        <li><strong>Google sign-in data:</strong> if you select “Continue with Google,” Google provides an account identifier and basic profile information such as your name and email address so we can authenticate you, create or access your landlord account, display your account identity, and protect sign-in. Supabase Auth also processes the authentication response and session. The app does not request access to Gmail messages, contacts, Drive files, Calendar, or other Google content.</li>
        <li><strong>Landlord and property data:</strong> landlord profile and verification details; property title, county, town or area, house type, rent, deposit, unit counts, amenities, rules, electricity notes, and listing photos.</li>
        <li><strong>Tenant and caretaker data:</strong> names, phone numbers, tenancy and unit details, rent and deposit terms, due dates, balances, invited-account status, caretaker assignments, and records needed to provide account features.</li>
        <li><strong>Viewing and communications data:</strong> prospective tenant name and phone number, selected property, requested date and time, verification-code status, viewing status and notes, messages, complaints, notices, and SMS content, recipients, segment counts and delivery status.</li>
        <li><strong>Verification documents:</strong> national identity and KRA information, plus uploaded identity-document images and KRA documents submitted by landlords for review.</li>
        <li><strong>Payment and service records:</strong> M-Pesa transaction and receipt references, amounts, payment attempts, rent ledger and payout records, subscription payments, SMS-wallet balances and top-ups, and relevant provider identifiers. The app does not ask for or store an M-Pesa PIN.</li>
        <li><strong>Security and technical records:</strong> authentication session information stored by the browser authentication client, audit and security events, timestamps, and hashed network identifiers used to limit verification-code abuse. We do not use the app to build advertising profiles or track users across unrelated websites.</li>
      </ul>
    </>,
  },
  {
    title: "How we use information, including Google user data",
    content: <>
      <p>We use account details to create accounts, authenticate users, recover or secure access, assign the correct role, and communicate about account status. Google name and email are used only for Google sign-in, account identification and operation and security of the landlord account. We do not use Google user data for advertising or creditworthiness decisions.</p>
      <p>We use landlord and property information to review eligibility, display and manage listings, calculate plan charges and unit counts, and administer properties. Tenant, caretaker and viewing information is used to manage invitations, tenancies, viewings, notices, complaints, rent balances and account access.</p>
      <p>We use payment information to initiate or reconcile M-Pesa payments, maintain transaction and payout records, operate subscriptions and SMS wallets, prevent duplicate or fraudulent transactions, and answer payment questions. Phone numbers and message content are used to send the SMS or verification code requested by the relevant service flow and record its status. Security information is used to protect accounts, investigate misuse and enforce rate limits.</p>
      <p>We do not sell personal data, use Google user data for targeted advertising, make it available to advertisers, or use it to train generalized artificial-intelligence or machine-learning models. We use Google user data only for the purposes described here and as necessary to provide or secure the service, comply with law, or respond to a user request.</p>
      <p>We process information where necessary to provide the service or take steps requested before a service is provided, to meet legal obligations, for legitimate interests such as account security and fraud prevention, and on consent where required. Where consent is the basis, you may withdraw it for future processing.</p>
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
    title: "When information is shared",
    content: <>
      <p><strong>Google:</strong> Google authenticates you when you choose Google sign-in and returns the basic account information described above. Google processes that activity under its own privacy terms.</p>
      <p><strong>Supabase:</strong> Supabase hosts the platform's authentication, database, private document storage and server functions. It processes account credentials and sessions, profile and service records, uploaded files, and information needed to run requested features.</p>
      <p><strong>Render:</strong> Render hosts the public website and serves its pages and static assets.</p>
      <p><strong>Safaricom:</strong> Safaricom Daraja processes M-Pesa payment requests and callbacks. Payment information needed to initiate, confirm or reconcile a transaction is sent to or received from Safaricom.</p>
      <p><strong>Celcom:</strong> Celcom receives the destination phone number and message text when the platform sends an SMS, and may return a message identifier or delivery response.</p>
      <p>Landlords receive information needed to respond to viewing requests and manage their own properties and tenancies. Tenants and caretakers receive information shown in their authorized account areas. Authorized administrators may access information required for verification, security, support, payment reconciliation and platform administration. We may also disclose limited information if legally required, to protect rights or safety, or to investigate fraud or abuse. We do not permit service providers to use personal information for their own advertising. Providers may process data in other countries under their terms and applicable safeguards.</p>
    </>,
  },
  {
    title: "Public information and access controls",
    content: <>
      <p>Vacant listings are public and may show the property title, county, town or area, house type, rent, deposit, amenities, availability and listing photos. The public listing is designed not to show the landlord's phone number, email address or exact property spot. A person who requests a viewing gives their name, phone number, selected property, date and time preference to the platform and the relevant landlord so they can respond.</p>
      <p>Private account information is restricted according to account role and database access rules. Landlords can access their own property and tenancy information; tenants can access information relating to their own tenancy; caretakers have limited information for assigned properties; and administrators have access appropriate to their duties. Identity and KRA files are stored in private storage and are available only to authorized reviewers and the submitting landlord.</p>
    </>,
  },
  {
    title: "Storage, security and retention",
    content: <>
      <p>Information is stored in the platform's Supabase project and in provider systems that support authentication, hosting, SMS and payment processing. Account sessions are maintained by the browser authentication client. House photos are resized and stripped of embedded location metadata before upload. Identity documents are stored separately in private storage. Saved landlord Daraja credentials are encrypted before storage.</p>
      <p>We apply role-based access controls, private document storage, encrypted payment credentials, authentication controls and security logging. These measures reduce risk but cannot guarantee absolute security. Protect your passwords and devices, sign out on shared devices, and contact us promptly about suspected account compromise.</p>
      <p>We retain account and profile information while an account is active and as needed to provide its features. Listings and related photos are kept while published or needed to administer the landlord's account. Viewing, tenancy, message and complaint information is retained while needed to perform the requested service, resolve follow-up issues and maintain related records. Identity and KRA documents are retained for landlord verification, fraud prevention, legal compliance and dispute handling, then securely removed when no longer needed, subject to legal holds.</p>
      <p>Payment, subscription, payout, audit and security records may be kept after an account closes when needed for accounting, legal compliance, fraud prevention or dispute resolution. Some financial and audit records are append-only in the current system and cannot be erased through the user interface. We do not currently provide an automatic account-deletion button or publish fixed deletion periods by record type. We review deletion requests individually and remove or de-identify information where it is no longer needed and the law and system records permit it. Backups and provider records may persist under the provider's retention cycle.</p>
    </>,
  },
  {
    title: "Your choices and rights",
    content: <>
      <p>You may ask us to confirm whether we process your information, provide access to it, correct inaccurate or incomplete information, explain how it is used, object to or ask us to restrict certain processing, request a copy of information you provided, request deletion where applicable, and withdraw consent where consent is the basis for processing. These requests are subject to applicable law and exceptions needed to protect other people or preserve records we are legally required or permitted to keep.</p>
      <p><strong>To request access, correction, export or deletion:</strong> email <a className="underline underline-offset-4 hover:text-bone" href="mailto:siskemejja@gmail.com">siskemejja@gmail.com</a> from the email address associated with your account, if possible. State “Privacy request” and describe the request and account email. We may ask for reasonable information to verify your identity before acting. We will acknowledge and handle the request within the period required by applicable law. Do not email passwords, M-Pesa PINs or identity-document attachments unless we provide a secure method.</p>
      <p>To stop using Google sign-in, you can stop choosing Google and may remove the app's access from your Google Account security settings. This does not by itself delete a Rental Houses Kenya account or records already retained by the platform; contact us to request account-data deletion. You may also complain to the Office of the Data Protection Commissioner in Kenya.</p>
    </>,
  },
  {
    title: "Children, policy changes and contact",
    content: <>
      <p>The platform is intended for adults arranging or managing rental housing, not for children to use independently. If you believe a child has provided personal information, contact us so we can review it.</p>
      <p>We may update this policy when our service or data practices change. We will publish the current version here, change its effective date, and provide additional notice where material changes or applicable law require it. If our use of Google user data changes, we will update this policy before using that data for a new purpose.</p>
      <p><strong>Data controller and privacy contact:</strong> Referraliq Solutions, Kenya. Email <a className="underline underline-offset-4 hover:text-bone" href="mailto:siskemejja@gmail.com">siskemejja@gmail.com</a>.</p>
    </>,
  },
];

export default function Privacy() {
  return (
    <article className="mx-auto grid max-w-4xl gap-5">
      <PageHead title="Privacy Policy" sub="How Rental Houses Kenya collects, uses and protects personal information." />
      <p className="text-sm text-graphite-400">Effective date: 25 October 2026. Public policy for Rental Houses Kenya, operated by Referraliq Solutions. Review against the live deployment, provider configurations and applicable Kenyan law before relying on it as legal advice.</p>
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
