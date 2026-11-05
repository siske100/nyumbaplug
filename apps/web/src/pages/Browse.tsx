import { useMemo, useRef, useState } from "react";
import { ArrowRight, BedDouble, Grid2X2, House, Images, List, MapPin, Search, ShieldCheck, Zap } from "lucide-react";
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
  const [activeSlide, setActiveSlide] = useState(0);
  const listingsRef = useRef<HTMLUListElement>(null);
  const filters = useMemo(() => ({
    county: county || undefined,
    type: type || undefined,
    maxRent: maxRent ? Number(maxRent) : undefined,
  }), [county, type, maxRent]);
  const { data, isPending, isError, refetch, isPlaceholderData } = useListings(filters);
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => sort === "low" ? a.rent - b.rent : b.rent - a.rent), [data, sort]);

  const scrollToListings = () => document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" });
  const scrollToResults = () => document.getElementById("listing-results")?.scrollIntoView({ behavior: "smooth" });
  const selectSlide = (index: number) => {
    const slide = listingsRef.current?.querySelectorAll("li")[index];
    slide?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  };

  return (
    <div className="-mx-3 -mt-4 grid grid-cols-[minmax(0,1fr)] gap-0 sm:-mx-6">
      <section
        className="relative isolate flex min-h-[28rem] flex-col justify-between overflow-hidden bg-slate-950 px-4 pb-32 pt-8 text-white lg:min-h-[22rem] lg:px-8 lg:pb-4 lg:pt-10"
        style={{
          backgroundImage: "linear-gradient(90deg, rgb(15 23 42 / 0.92) 0%, rgb(15 23 42 / 0.67) 48%, rgb(15 23 42 / 0.08) 100%), linear-gradient(0deg, rgb(15 23 42 / 0.72), transparent 65%), url('/apartment-building.jpg')",
          backgroundPosition: "center, center, center 56%",
          backgroundSize: "cover",
        }}
      >
        <div className="mx-auto w-full max-w-[1440px]">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold backdrop-blur">
            <span className="grid size-7 place-items-center rounded-full bg-emerald-600"><House className="size-4" aria-hidden /></span>
            Rental Houses Kenya
          </p>
          <h1 className="mt-3 max-w-[8em] font-display text-5xl font-bold leading-[1.02] lg:max-w-2xl">
            Find vacant rental homes across <span className="text-emerald-400">Kenya</span>
          </h1>
          <p className="mt-3 max-w-sm text-base leading-6 text-white/90 lg:max-w-xl">
            Browse verified listings without an account, compare options, and book viewings with ease.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-white/95 sm:text-sm">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-5 text-yellow-400" aria-hidden />Verified listings</span>
            <span className="inline-flex items-center gap-1.5"><Zap className="size-5 text-yellow-400" aria-hidden />Easy booking</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="size-5 text-yellow-400" aria-hidden />Nationwide coverage</span>
          </div>
        </div>

        <div className="absolute inset-x-3 bottom-7 z-10 mx-auto grid w-auto max-w-[1440px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-0 rounded-2xl bg-white p-2 text-slate-900 shadow-xl lg:relative lg:inset-auto lg:mt-8 lg:w-full lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end lg:p-2">
          <label className="grid min-w-0 gap-1 border-r border-slate-200 px-2 py-1 text-[11px] font-bold lg:px-4 lg:text-xs">
            Location
            <select value={county} onChange={(event) => setCounty(event.target.value as County | "")} className="w-full truncate bg-white text-xs font-medium text-slate-700 outline-none lg:text-sm">
              <option value="">Any County</option>
              {COUNTIES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 px-2 py-1 text-[11px] font-bold lg:border-l lg:border-slate-200 lg:px-4 lg:text-xs">
            Property type
            <select value={type} onChange={(event) => setType(event.target.value as HouseType | "")} className="w-full truncate bg-white text-xs font-medium text-slate-700 outline-none lg:text-sm">
              <option value="">Any Type</option>
              {HOUSE_TYPES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="hidden gap-1 border-slate-200 px-2 py-1 text-xs font-bold lg:grid lg:border-l lg:px-4">
            Price range
            <select value={maxRent} onChange={(event) => setMaxRent(event.target.value)} className="w-full bg-white text-sm font-medium text-slate-700 outline-none">
              {PRICE_LIMITS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button type="button" onClick={scrollToListings} className="h-11 min-w-11 bg-rose-900 px-3 text-white hover:bg-rose-800 lg:px-4">
            <Search className="size-5 shrink-0" aria-hidden /><span className="lg:hidden">Search</span><span className="hidden lg:inline">Search properties</span>
          </Button>
        </div>
        <p className="absolute bottom-1 right-3 z-10 text-right text-[9px] text-white/75 lg:right-6">
          Illustrative photo: <a href="https://commons.wikimedia.org/wiki/File:Kengen_RBS_Gardens_-_Serviced_Apartments_-_panoramio.jpg" target="_blank" rel="noreferrer" className="underline">Chetan Mahajan, CC BY 3.0</a>
        </p>
      </section>

      <section id="properties" className="scroll-mt-20 bg-white px-3 py-6 lg:bg-slate-50 lg:px-6 lg:py-8">
        <div className="mx-auto max-w-[1440px]">
          <h2 className="mb-3 font-sans text-2xl font-extrabold text-slate-900 lg:hidden">Browse by Property Type</h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex max-w-full flex-wrap gap-1.5" role="group" aria-label="Filter by property type">
              <button onClick={() => setType("")} className={cn("rounded-full border px-4 py-2 text-sm font-semibold", type === "" ? "border-rose-900 bg-rose-900 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-rose-300 lg:bg-white")}>All properties</button>
              {QUICK_TYPES.map((item) => (
                <button key={item} onClick={() => setType(item)} className={cn("rounded-full border px-4 py-2 text-sm font-semibold", type === item ? "border-rose-900 bg-rose-900 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-rose-300 lg:bg-white")}><BedDouble className="mr-1 inline size-4" aria-hidden />{item === "2 Bedroom" || item === "3 Bedroom" ? `${item}s` : item}</button>
              ))}
              <label className="sr-only" htmlFor="more-types">More property types</label>
              <select id="more-types" value={type && !QUICK_TYPES.includes(type) ? type : ""} onChange={(event) => setType(event.target.value as HouseType | "")} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 lg:bg-white">
                <option value="">More</option>
                {HOUSE_TYPES.filter((item) => !QUICK_TYPES.includes(item)).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="flex w-full items-center gap-2 lg:hidden">
              <label htmlFor="mobile-price-range" className="shrink-0 text-xs font-semibold text-slate-600">Max rent</label>
              <select id="mobile-price-range" value={maxRent} onChange={(event) => setMaxRent(event.target.value)} className="min-w-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {PRICE_LIMITS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <label htmlFor="sort-properties" className="text-xs font-semibold text-slate-500">Sort by:</label>
              <select id="sort-properties" value={sort} onChange={(event) => setSort(event.target.value as "low" | "high")} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <option value="low">Price: low to high</option>
                <option value="high">Price: high to low</option>
              </select>
              <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("grid size-9 place-items-center rounded-lg", view === "grid" ? "bg-rose-900 text-white" : "bg-white text-slate-600")}><Grid2X2 className="size-4" aria-hidden /></button>
              <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("grid size-9 place-items-center rounded-lg", view === "list" ? "bg-rose-900 text-white" : "bg-white text-slate-600")}><List className="size-4" aria-hidden /></button>
            </div>
          </div>

          <div id="listing-results" className="mt-7 scroll-mt-24" aria-live="polite" aria-busy={isPending || isPlaceholderData}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-2xl font-bold text-slate-900">Featured Properties</h2>
              <button type="button" onClick={scrollToResults} className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-rose-900 lg:hidden">See all <ArrowRight className="size-4" aria-hidden /></button>
            </div>
            {isError ? (
              <Panel className="bg-white p-8 text-center text-slate-700">
                <p className="text-lg font-bold">We could not load houses.</p>
                <p className="mt-1 text-slate-500">Check your connection and try again.</p>
                <Button className="mt-5" onClick={() => void refetch()}>Try again</Button>
              </Panel>
            ) : isPending ? (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-72 rounded-xl" />)}</div>
            ) : sorted.length === 0 ? (
              <Panel className="bg-white p-4"><ToLet title="No vacant houses match yet" note="Try another county, price range or house type." /></Panel>
            ) : (
              <>
                <p className="mb-3 hidden text-sm text-slate-500 lg:block">{sorted.length} {sorted.length === 1 ? "property" : "properties"} available</p>
                <ul
                  ref={listingsRef}
                  onScroll={(event) => setActiveSlide(Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth))}
                  className={cn("hide-scrollbar -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 transition-opacity lg:mx-0 lg:grid lg:gap-4 lg:overflow-visible lg:px-0", view === "grid" ? "lg:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-1", isPlaceholderData && "opacity-60")}
                >
                  {sorted.map((house) => (
                    <li key={house.id} className="w-full shrink-0 snap-center lg:w-auto lg:shrink">
                      <Link to={`/house/${house.id}`} className="group block h-full rounded-xl focus-visible:outline-offset-4">
                        <article className={cn("h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", view === "list" && "grid lg:grid-cols-[minmax(16rem,0.42fr)_1fr]")}>
                          <div className="relative h-36 overflow-hidden bg-slate-200 lg:h-44">
                            <img src={house.coverPhoto ?? "/apartment-building.jpg"} alt={house.title} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                            <span className="absolute right-2 top-2 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">{house.vacant} available</span>
                          </div>
                          <div className="grid gap-2.5 p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h2 className="truncate font-sans font-extrabold text-slate-900">{house.title}</h2>
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
                {sorted.length > 1 && <div className="mt-3 flex justify-center gap-2 lg:hidden" aria-label="Property carousel pages">
                  {sorted.map((house, index) => <button key={house.id} type="button" aria-label={`Show property ${index + 1}`} aria-current={activeSlide === index ? "true" : undefined} onClick={() => selectSlide(index)} className={cn("size-2.5 rounded-full", activeSlide === index ? "bg-rose-900" : "bg-slate-300")} />)}
                </div>}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
