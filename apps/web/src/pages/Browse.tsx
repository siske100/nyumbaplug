import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SelectField } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { COUNTIES, HOUSE_TYPES, type County, type HouseType } from "@/data/counties";
import { useListings } from "@/features/houses/useListings";
import { cn } from "@/lib/cn";
import { formatKes, plural } from "@/lib/format";

export default function Browse() {
  const [county, setCounty] = useState<County | "">("");
  const [type, setType] = useState<HouseType | "">("");
  const filters = useMemo(() => ({ county: county || undefined, type: type || undefined }), [county, type]);
  const { data, isPending, isError, refetch, isPlaceholderData } = useListings(filters);

  return (
    <div className="grid gap-8">
      <Panel
        tone="hero"
        className="overflow-hidden p-6 pb-14 sm:p-10 sm:pb-14"
        style={{
          backgroundImage: "linear-gradient(90deg, rgb(13 13 15 / 0.94) 0%, rgb(13 13 15 / 0.78) 48%, rgb(13 13 15 / 0.48) 100%), linear-gradient(0deg, rgb(13 13 15 / 0.55), transparent 55%), url('/apartment-building.jpg')",
          backgroundPosition: "center, center, center 56%",
          backgroundSize: "cover",
        }}
      >
        <p className="mb-2 text-sm font-medium text-ember-300">Rental Houses Kenya · operated by Referraliq Solutions</p>
        <h1 className="relative max-w-2xl text-4xl leading-[1.1] sm:text-5xl">Find vacant rental homes across Kenya</h1>
        <p className="mt-3 max-w-xl text-graphite-200">Browse listings without an account, compare available homes and request a viewing. Landlords can publish properties and manage tenancies.</p>
        <div className="mt-7 grid max-w-2xl gap-3 sm:grid-cols-[1fr_auto]">
          <SelectField label="County" value={county} onChange={(e) => setCounty(e.target.value as County | "")}>
            <option value="">All 47 counties</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectField>
          <div className="flex flex-wrap items-end gap-2" role="group" aria-label="House type">
            <Button variant={type === "" ? "primary" : "glass"} size="sm" onClick={() => setType("")}>Any type</Button>
            {HOUSE_TYPES.map((t) => <Button key={t} variant={type === t ? "primary" : "glass"} size="sm" onClick={() => setType(t)}>{t}</Button>)}
          </div>
        </div>
        <p className="absolute bottom-3 left-4 right-4 z-10 rounded-md bg-graphite-950/70 px-2 py-1 text-right text-[10px] text-graphite-200 sm:left-auto sm:max-w-[70%]">
          Illustrative photo: “Kengen RBS Gardens - Serviced Apartments” by <a href="https://commons.wikimedia.org/wiki/File:Kengen_RBS_Gardens_-_Serviced_Apartments_-_panoramio.jpg" target="_blank" rel="noreferrer" className="underline underline-offset-2">Chetan Mahajan</a>
          {" "}· resized, cropped and darkened · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer" className="underline underline-offset-2">CC BY 3.0</a>
        </p>
      </Panel>

      <section aria-live="polite" aria-busy={isPending || isPlaceholderData}>
        {isError ? (
          <Panel className="p-8 text-center">
            <p className="text-lg">We could not load houses.</p>
            <p className="mt-1 text-graphite-300">Check your connection and try again.</p>
            <Button className="mt-5" onClick={() => void refetch()}>Try again</Button>
          </Panel>
        ) : isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-52" />)}</div>
        ) : data.length === 0 ? (
          <Panel className="p-4"><ToLet title="No vacant houses match yet" note="Try another county or house type. Houses that are full are hidden automatically." /></Panel>
        ) : (
          <>
            <p className="mb-4 text-graphite-300">{plural(data.length, "listing")} with vacant units</p>
            <ul className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3 transition-opacity", isPlaceholderData && "opacity-60")}>
              {data.map((h) => (
                <li key={h.id}>
                  <Link to={`/house/${h.id}`} className="block h-full rounded-2xl focus-visible:outline-offset-4">
                  <Panel className="flex h-full flex-col gap-4 p-5 transition-transform hover:-translate-y-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-xl">{h.title}</h2>
                        <p className="text-sm text-graphite-300">{h.town}, {h.county}</p>
                      </div>
                      <Chip tone="ok">{h.vacant} of {h.total} vacant</Chip>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip>{h.type}</Chip>
                      {h.amenities.slice(0, 3).map((a) => <Chip key={a}>{a}</Chip>)}
                    </div>
                    <div className="mt-auto flex items-end justify-between">
                      <div>
                        <p className="font-display text-2xl">{formatKes(h.rent)}</p>
                        <p className="text-sm text-graphite-300">per month</p>
                      </div>
                      <span className="text-sm text-graphite-300">{h.photoCount} photos</span>
                    </div>
                  </Panel>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="about-rental-houses" className="grid gap-4">
        <Panel className="grid gap-3 p-5 sm:p-7">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-ember-300">About the service</p>
          <h2 id="about-rental-houses" className="text-3xl">Rental Houses Kenya</h2>
          <p className="max-w-3xl leading-7 text-graphite-200">
            A rental discovery and property-management platform operated by Referraliq Solutions. People can browse vacant rental listings across Kenya without signing in, compare rent and property details, and request a viewing. Landlords can publish available houses and manage viewing requests, tenants, rent records, notices and tenant SMS. Invited tenants and caretakers can use their account areas to manage tenancy-related tasks.
          </p>
        </Panel>

        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="grid content-start gap-2 p-5">
            <h3 className="text-xl">For house hunters</h3>
            <p className="text-sm leading-6 text-graphite-300">Browse by county and house type, review rent, amenities and vacancy information, then request a viewing. A phone number is verified by SMS to reduce false requests and let the landlord follow up about the viewing.</p>
          </Panel>
          <Panel className="grid content-start gap-2 p-5">
            <h3 className="text-xl">For landlords</h3>
            <p className="text-sm leading-6 text-graphite-300">Create a landlord account, submit details for review, publish available houses, manage tenants and payment records, and choose whether rent goes to the platform Paybill or your own connected Paybill. Google sign-in uses basic Google account information to create or access your landlord account; it does not access Gmail, Drive or contacts.</p>
            <Link to="/sign-up" className="mt-1 text-sm text-ember-300 underline-offset-4 hover:underline">Create a landlord account</Link>
          </Panel>
          <Panel className="grid content-start gap-2 p-5">
            <h3 className="text-xl">For tenants and caretakers</h3>
            <p className="text-sm leading-6 text-graphite-300">Landlords invite tenants and caretakers. Depending on the role, invited users can access tenancy information, rent payments, documents, notices, complaints or assigned property tasks.</p>
          </Panel>
        </div>

        <Panel className="grid gap-3 p-5 sm:p-7">
          <h2 className="text-2xl">Why we ask for information</h2>
          <ul className="grid gap-2 text-sm leading-6 text-graphite-300">
            <li><strong className="text-bone">Sign-in details:</strong> your name and email identify your account; passwords or Google sign-in authenticate it. Google provides basic profile information for sign-in only.</li>
            <li><strong className="text-bone">Phone number:</strong> used for requested viewing verification, account messages, and landlord M-Pesa prompts or SMS features, as relevant to your role.</li>
            <li><strong className="text-bone">Landlord identity and KRA documents:</strong> collected to review landlord eligibility and help protect rental listings from fraudulent accounts.</li>
            <li><strong className="text-bone">Viewing request details:</strong> your name, verified phone number, selected house and preferred time are shared with the relevant landlord so they can respond and arrange the viewing.</li>
            <li><strong className="text-bone">Payment and message records:</strong> used to confirm and reconcile M-Pesa transactions, maintain rent records, send requested SMS and track delivery. We do not ask for or store your M-Pesa PIN.</li>
          </ul>
          <p className="text-sm leading-6 text-graphite-300">
            We do not sell personal information. Access to private account information is limited by role. Read the <Link to="/privacy" className="text-ember-300 underline underline-offset-4 hover:text-bone">Privacy Policy</Link> for details about collection, use, service providers, retention and privacy requests, or contact <a href="mailto:siskemejja@gmail.com" className="text-ember-300 underline underline-offset-4 hover:text-bone">siskemejja@gmail.com</a>.
          </p>
        </Panel>
      </section>
    </div>
  );
}
