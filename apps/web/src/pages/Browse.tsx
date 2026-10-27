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

    </div>
  );
}
