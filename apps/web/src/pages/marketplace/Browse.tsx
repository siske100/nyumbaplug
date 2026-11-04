import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { ToLet } from "@/components/motion/Doodles";
import { Chip } from "@/components/ui/Chip";
import { SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { COUNTIES, type County } from "@/data/counties";
import { useLive } from "@/features/live";
import { formatKes } from "@/lib/format";

export default function MarketplaceBrowse() {
  const [county, setCounty] = useState<County | "">("");
  const listings = useLive("public", `marketplace-listings-${county}`, () => api.marketplace.publicListings(county || undefined));

  return (
    <div className="grid gap-5">
      <PageHead title="Book a house viewing" sub="Browse houses posted by independent marketers. Pay the viewing fee on M-Pesa, meet the marketer in person, then confirm the viewing in your client account." />
      <Panel className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <SelectField label="County" value={county} onChange={(e) => setCounty(e.target.value as County | "")}>
          <option value="">All counties</option>
          {COUNTIES.map((name) => <option key={name} value={name}>{name}</option>)}
        </SelectField>
        <Link to="/sign-up?account=marketer" className="text-sm text-ember-300 underline-offset-4 hover:underline">Become a marketer</Link>
      </Panel>
      <ErrorNote error={listings.error} />
      {listings.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-56" />)}</div>
      ) : listings.data?.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.data.map((house) => (
            <li key={house.id}>
              <Link to={`/marketplace/${house.id}`} className="block h-full rounded-2xl focus-visible:outline-offset-4">
                <Panel className="grid h-full gap-3 p-5 transition-transform hover:-translate-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl">{house.title}</h2><Chip>{house.type}</Chip>
                  </div>
                  <p className="text-sm text-graphite-300">{house.town}, {house.county} · Listed by {house.marketerName}</p>
                  <p className="line-clamp-3 text-sm text-graphite-200">{house.description}</p>
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-white/8 pt-3">
                    <div><p className="font-display text-xl">{formatKes(house.rent)}</p><p className="text-xs text-graphite-400">monthly rent</p></div>
                    <div className="text-right"><p className="font-medium text-ember-300">{formatKes(house.viewingFee)}</p><p className="text-xs text-graphite-400">viewing fee</p></div>
                  </div>
                </Panel>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Panel className="p-5"><ToLet title="No viewing houses listed yet" note="Try another county, or check back later." /></Panel>
      )}
    </div>
  );
}
