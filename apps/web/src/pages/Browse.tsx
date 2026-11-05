import { useMemo, useState } from "react";
import { ArrowRight, BedDouble, Grid2X2, Images, List, MapPin, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { COUNTIES, HOUSE_TYPES, type County, type HouseType } from "@/data/counties";
import { useListings } from "@/features/houses/useListings";
import { formatKes } from "@/lib/format";
import { cn } from "@/lib/cn";

const QUICK_TYPES: HouseType[] = ["Bedsitter", "1 Bedroom", "2 Bedroom", "3 Bedroom"];
const PRICE_LIMITS = [
  { label: "Any price", value: "" },
  { label: "Up to KES 10,000", value: "10000" },
  { label: "Up to KES 20,000", value: "20000" },
  { label: "Up to KES 40,000", value: "40000" },
];

export default function Browse() {
  const [county, setCounty] = useState<County | "">("");
  const [type, setType] = useState<HouseType | "">("");
  const [maxRent, setMaxRent] = useState("");
  const [sort, setSort] = useState<"low" | "high">("low");
  const [view, setView] = useState<"grid" | "list">("grid");
  const filters = useMemo(() => ({
    county: county || undefined,
    type: type || undefined,
    maxRent: maxRent ? Number(maxRent) : undefined,
  }), [county, type, maxRent]);
  const { data, isPending, isError, refetch, isPlaceholderData } = useListings(filters);
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => sort === "low" ? a.rent - b.rent : b.rent - a.rent), [data, sort]);

  const scrollToListings = () => document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="-mx-3 -mt-4 grid gap-0 sm:-mx-6">
      <section
        className="relative isolate flex min-h-[25rem] flex-col justify-between overflow-hidden bg-rose-950 px-4 pb-4 pt-8 text-white sm:min-h-[22rem] sm:px-8 sm:pt-10"
        style={{
          backgroundImage: "linear-gradient(90deg, rgb(91 0 34 / 0.96) 0%, rgb(91 0 34 / 0.83) 39%, rgb(91 0 34 / 0.2) 100%), linear-gradient(0deg, rgb(91 0 34 / 0.85), transparent 55%), url('/apartment-building.jpg')",
          backgroundPosition: "center, center, center 56%",
          backgroundSize: "cover",
        }}
      >
        <div className="mx-auto w-full max-w-[1440px]">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold backdrop-blur">
            <span className="grid size-7 place-items-center rounded-full bg-emerald-500"><MapPin className="size-4" aria-hidden /></span>
            Rental Houses Kenya
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl font-bold leading-[1.05] sm:text-5xl">
            Find vacant rental homes across <span className="text-emerald-400">Kenya</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/90 sm:text-base">
            Browse verified listings without an account, compare options, and book viewings with ease.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/90 sm:text-sm">
            <span>✓ Verified listings</span><span>↯ Easy booking</span><span>⌖ Nationwide coverage</span>
          </div>
        </div>

        <div className="relative z-10 mx-auto mt-8 grid w-full max-w-[1440px] gap-2 rounded-2xl bg-white p-3 text-slate-900 shadow-xl sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end sm:gap-0 sm:p-2">
          <label className="grid gap-1 px-2 py-1 text-xs font-bold sm:px-4">
            Location
            <select value={county} onChange={(event) => setCounty(event.target.value as County | "")} className="w-full bg-white text-sm font-medium text-slate-700 outline-none">
              <option value="">Any County</option>
              {COUNTIES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 border-slate-200 px-2 py-1 text-xs font-bold sm:border-l sm:px-4">
            Property type
            <select value={type} onChange={(event) => setType(event.target.value as HouseType | "")} className="w-full bg-white text-sm font-medium text-slate-700 outline-none">
              <option value="">Any Type</option>
              {HOUSE_TYPES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 border-slate-200 px-2 py-1 text-xs font-bold sm:border-l sm:px-4">
            Price range
            <select value={maxRent} onChange={(event) => setMaxRent(event.target.value)} className="w-full bg-white text-sm font-medium text-slate-700 outline-none">
              {PRICE_LIMITS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button type="button" onClick={scrollToListings} className="h-11 bg-rose-900 text-white hover:bg-rose-800">
            <Search className="size-4" aria-hidden /> Search properties
          </Button>
        </div>
        <p className="absolute bottom-1 right-3 z-10 text-right text-[9px] text-white/75 sm:right-6">
          Illustrative photo: <a href="https://commons.wikimedia.org/wiki/File:Kengen_RBS_Gardens_-_Serviced_Apartments_-_panoramio.jpg" target="_blank" rel="noreferrer" className="underline">Chetan Mahajan, CC BY 3.0</a>
        </p>
      </section>

      <section id="properties" className="scroll-mt-20 bg-slate-50 px-3 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-[1440px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex max-w-full flex-wrap gap-1.5" role="group" aria-label="Filter by property type">
              <button onClick={() => setType("")} className={cn("rounded-full border px-4 py-2 text-sm font-semibold", type === "" ? "border-rose-900 bg-rose-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-rose-300")}>All properties</button>
              {QUICK_TYPES.map((item) => (
                <button key={item} onClick={() => setType(item)} className={cn("rounded-full border px-4 py-2 text-sm font-semibold", type === item ? "border-rose-900 bg-rose-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-rose-300")}>{item}</button>
              ))}
              <label className="sr-only" htmlFor="more-types">More property types</label>
              <select id="more-types" value={type && !QUICK_TYPES.includes(type) ? type : ""} onChange={(event) => setType(event.target.value as HouseType | "")} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                <option value="">More</option>
                {HOUSE_TYPES.filter((item) => !QUICK_TYPES.includes(item)).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="sort-properties" className="text-xs font-semibold text-slate-500">Sort by:</label>
              <select id="sort-properties" value={sort} onChange={(event) => setSort(event.target.value as "low" | "high")} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <option value="low">Price: low to high</option>
                <option value="high">Price: high to low</option>
              </select>
              <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("grid size-9 place-items-center rounded-lg", view === "grid" ? "bg-rose-900 text-white" : "bg-white text-slate-600")}><Grid2X2 className="size-4" aria-hidden /></button>
              <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("grid size-9 place-items-center rounded-lg", view === "list" ? "bg-rose-900 text-white" : "bg-white text-slate-600")}><List className="size-4" aria-hidden /></button>
            </div>
          </div>

          <div className="mt-5" aria-live="polite" aria-busy={isPending || isPlaceholderData}>
            {isError ? (
              <Panel className="bg-white p-8 text-center text-slate-700">
                <p className="text-lg font-bold">We could not load houses.</p>
                <p className="mt-1 text-slate-500">Check your connection and try again.</p>
                <Button className="mt-5" onClick={() => void refetch()}>Try again</Button>
              </Panel>
            ) : isPending ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-72 rounded-xl" />)}</div>
            ) : sorted.length === 0 ? (
              <Panel className="bg-white p-4"><ToLet title="No vacant houses match yet" note="Try another county, price range or house type." /></Panel>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-500">{sorted.length} {sorted.length === 1 ? "property" : "properties"} available</p>
                <ul className={cn("grid gap-4 transition-opacity", view === "grid" ? "sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1", isPlaceholderData && "opacity-60")}>
                  {sorted.map((house) => (
                    <li key={house.id}>
                      <Link to={`/house/${house.id}`} className="group block h-full rounded-xl focus-visible:outline-offset-4">
                        <article className={cn("h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", view === "list" && "grid sm:grid-cols-[minmax(16rem,0.42fr)_1fr]")}>
                          <div className="relative h-44 overflow-hidden bg-slate-200 sm:h-44">
                            <img src={house.coverPhoto ?? "/apartment-building.jpg"} alt={house.title} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                            <span className="absolute right-2 top-2 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">{house.vacant} available</span>
                          </div>
                          <div className="grid gap-2.5 p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h2 className="truncate font-bold text-slate-900">{house.title}</h2>
                                <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500"><MapPin className="size-3.5 shrink-0" aria-hidden />{house.town}, {house.county}</p>
                              </div>
                              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Verified</span>
                            </div>
                            <p className="font-display text-lg font-bold text-rose-900">{formatKes(house.rent)} <span className="font-sans text-xs font-medium text-slate-500">/ month</span></p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                              <span className="inline-flex items-center gap-1"><BedDouble className="size-3.5" aria-hidden />{house.type}</span>
                              <span>{house.vacant}/{house.total} vacant</span>
                              <span className="inline-flex items-center gap-1"><Images className="size-3.5" aria-hidden />{house.photoCount} photos</span>
                              <span className="ml-auto inline-flex items-center gap-1 font-bold text-rose-900">View details <ArrowRight className="size-3.5" aria-hidden /></span>
                            </div>
                          </div>
                        </article>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
