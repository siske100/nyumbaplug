import { Minus, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { houseSchema, HOUSE_TYPES, MAX_PHOTOS, MIN_PHOTOS, validatePhoto, type HouseType } from "@rh/shared";
import { api } from "@/api";
import type { HouseForEdit, HouseInput } from "@/api/types";
import { ToLet } from "@/components/motion/Doodles";
import { Windows } from "@/components/motion/HouseScene";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLandlordHouses, useSetVacantUnits } from "@/features/landlord/hooks";
import { useLive, useLiveMutation } from "@/features/live";
import { formatKes } from "@/lib/format";

const AMENITIES = ["Water", "Tiled floor", "Security light", "Parking", "Balcony", "Fenced compound", "CCTV", "Wifi ready"];

function PostHouse({ onDone, houseId }: { onDone: () => void; houseId?: string }) {
  const existing = useLive("landlord", `house-edit:${houseId ?? ""}`, () => api.landlord.houseForEdit(houseId!), { enabled: !!houseId });

  if (houseId && existing.isPending) return <Panel className="p-5">Loading listing…</Panel>;
  if (houseId && (existing.isError || !existing.data)) {
    return <Panel className="grid gap-3 p-5">{existing.error ? <ErrorNote error={existing.error} /> : <p role="alert">We could not load this listing.</p>}<Button variant="ghost" onClick={onDone}>Close</Button></Panel>;
  }
  return <HouseForm onDone={onDone} initial={existing.data} houseId={houseId} />;
}

function HouseForm({ onDone, initial, houseId }: { onDone: () => void; initial?: HouseForEdit; houseId?: string }) {
  const places = useLive("landlord", "places", () => api.landlord.places());
  const post = useLiveMutation("landlord", (v: { houseId?: string; input: HouseInput; files: File[] }) =>
    v.houseId ? api.landlord.updateHouse(v.houseId, v.input, v.files) : api.landlord.postHouse(v.input, v.files));
  const [f, setF] = useState(() => initial
    ? { ...initial.input, rent: String(initial.input.rent), deposit: String(initial.input.deposit), total: String(initial.input.total), vacant: String(initial.input.vacant) }
    : { title: "", countyId: 0, townId: 0, type: "Bedsitter" as HouseType, rent: "", deposit: "", total: "", vacant: "", amenities: [] as string[], rules: "", electricityNote: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const towns = useMemo(() => (places.data?.towns ?? []).filter((t) => t.countyId === f.countyId), [places.data, f.countyId]);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next = [...files]; let problem = "";
    for (const file of Array.from(list)) {
      const c = validatePhoto(file, new Uint8Array(await file.slice(0, 12).arrayBuffer()));
      if (!c.ok) problem = `${file.name}: ${c.reason}`; else if ((initial?.photos.length ?? 0) + next.length < MAX_PHOTOS) next.push(file); else problem = `At most ${MAX_PHOTOS} photos`;
    }
    setFiles(next); setErrs((e) => ({ ...e, photos: problem }));
  };

  const submit = () => {
    const county = places.data?.counties.find((c) => c.id === f.countyId)?.name, town = towns.find((t) => t.id === f.townId)?.name;
    const r = houseSchema.safeParse({ title: f.title, county, town, type: f.type, rent: Number(f.rent), total: Number(f.total), vacant: Number(f.vacant), photos: (initial?.photos.length ?? 0) + files.length });
    if (!r.success) { const e: Record<string, string> = {}; for (const i of r.error.issues) e[String(i.path[0])] ??= i.message; if (!county) e.county = "Choose a county"; if (!town) e.town = "Choose a town or area"; setErrs(e); return; }
    setErrs({});
    post.mutate({ houseId, files, input: { ...f, title: f.title.trim(), rent: Number(f.rent), deposit: Number(f.deposit || f.rent), total: Number(f.total), vacant: Number(f.vacant), rules: f.rules.trim(), electricityNote: f.electricityNote.trim() } }, { onSuccess: onDone });
  };

  return (
    <Panel tone="hero" className="grid gap-4 p-5 sm:p-6">
      <h2 className="text-2xl">{houseId ? "Edit listing" : "Post a house"}</h2>
      <ErrorNote error={places.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Listing name" placeholder="Bedsitters, Block D" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errs.title} />
        <SelectField label="House type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as HouseType })}>{HOUSE_TYPES.map((t) => <option key={t}>{t}</option>)}</SelectField>
        <SelectField label="County" value={f.countyId} onChange={(e) => setF({ ...f, countyId: Number(e.target.value), townId: 0 })} error={errs.county}><option value={0}>Choose a county</option>{places.data?.counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
        <SelectField label="Town or area" value={f.townId} onChange={(e) => setF({ ...f, townId: Number(e.target.value) })} error={errs.town} hint={f.countyId && towns.length === 0 ? "No towns for this county yet. Ask support to add one." : undefined}><option value={0}>Choose a town</option>{towns.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField>
        <Field label="Rent per month (KES)" type="number" inputMode="numeric" value={f.rent} onChange={(e) => setF({ ...f, rent: e.target.value })} error={errs.rent} />
        <Field label="Deposit (KES)" type="number" inputMode="numeric" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} hint="Leave empty to use one month's rent" />
        <Field label="Total units" type="number" inputMode="numeric" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} error={errs.total} />
        <Field label="Vacant units now" type="number" inputMode="numeric" value={f.vacant} onChange={(e) => setF({ ...f, vacant: e.target.value })} error={errs.vacant} hint="You can change this any time" />
      </div>
      <fieldset><legend className="mb-2 text-sm text-graphite-200">Amenities</legend>
        <div className="flex flex-wrap gap-2">{AMENITIES.map((a) => <Button key={a} variant={f.amenities.includes(a) ? "primary" : "glass"} size="sm" onClick={() => setF({ ...f, amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a] })}>{a}</Button>)}</div>
      </fieldset>
      <Field label="Electricity" placeholder="KPLC prepaid, own meter" value={f.electricityNote} onChange={(e) => setF({ ...f, electricityNote: e.target.value })} />
      <Field label="House rules" placeholder="No pets. Gate closes at 10pm." value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} />
      <div>
        <p className="mb-1.5 text-sm text-graphite-200">Photos ({(initial?.photos.length ?? 0) + files.length} of {MAX_PHOTOS}, at least {MIN_PHOTOS}). The first is the cover.</p>
        {initial?.photos.length ? (
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {initial.photos.map((photo, i) => <img key={photo.path} src={photo.url} alt={`${f.title}, photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" />)}
          </div>
        ) : null}
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => void addFiles(e.target.files)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-bone" aria-label="Choose photos" />
        {houseId && <p className="mt-1 text-sm text-graphite-400">Current photos stay on the listing. Add new photos here; existing photos cannot be removed.</p>}
        {files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{files.map((file, i) => <Chip key={file.name + i}>{houseId ? "New photo: " : i === 0 ? "Cover: " : ""}{file.name.slice(0, 22)} <button className="ml-1" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}>×</button></Chip>)}</div>}
        <p className="mt-1.5 text-sm text-graphite-400">Photos are shrunk and stripped of hidden location data on your device before they are uploaded.</p>
        {errs.photos && <p role="alert" className="mt-1 text-sm text-danger">{errs.photos}</p>}
      </div>
      <ErrorNote error={post.error} />
      <div className="flex gap-2"><Button magnetic loading={post.isPending} onClick={submit}>{houseId ? "Save changes" : "Publish listing"}</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
    </Panel>
  );
}

export default function Houses() {
  const { data, isPending, isError } = useLandlordHouses();
  const setVacant = useSetVacantUnits();
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const change = (id: string, vacant: number) => { setProblem(null); setVacant.mutate({ houseId: id, vacant }, { onError: (e) => setProblem({ id, message: e.message }) }); };

  return (
    <div className="grid gap-4">
      <PageHead title="Houses" sub="Edit your listing details and keep the vacant count accurate. At zero, a listing leaves search and stops taking viewing requests." action={!posting && !editingId && <Button magnetic onClick={() => setPosting(true)}>Post a house</Button>} />
      {posting && <PostHouse onDone={() => setPosting(false)} />}
      {isError && <Panel className="p-6">We could not load your houses. Refresh to try again.</Panel>}
      {isPending && [0, 1].map((i) => <div key={i} className="skeleton h-24" />)}
      {data?.length === 0 && !posting && <Panel className="p-4"><ToLet title="No houses yet" note="Post your first house with 3 to 7 photos and it appears in search straight away." /></Panel>}
      <ul className="grid gap-3">
        {data?.map((h) => (
          <li key={h.id}>
            {editingId === h.id ? <PostHouse houseId={h.id} onDone={() => setEditingId(null)} /> : <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-48">
                <h2 className="text-xl">{h.title}</h2>
                <p className="text-sm text-graphite-300">{h.town}, {h.county} · {h.type} · {formatKes(h.rent)}</p>
                <p className="mt-1 text-sm text-graphite-400">{h.photoCount} photos</p>
              </div>
              <div className="grid justify-items-center gap-1.5">
                <Windows total={h.total} vacant={h.vacant} />
                <div className="flex items-center gap-3">
                  <Button variant="glass" size="sm" aria-label={`Fewer vacant units in ${h.title}`} disabled={h.vacant <= 0} onClick={() => change(h.id, h.vacant - 1)}><Minus className="size-4" /></Button>
                  <p className="min-w-28 text-center" aria-live="polite"><span className="font-display text-2xl">{h.vacant}</span> <span className="text-graphite-300">of {h.total} vacant</span></p>
                  <Button variant="glass" size="sm" aria-label={`More vacant units in ${h.title}`} disabled={h.vacant >= h.total} onClick={() => change(h.id, h.vacant + 1)}><Plus className="size-4" /></Button>
                </div>
              </div>
              {h.vacant > 0 ? <Chip tone="ok">Listed</Chip> : <Chip>Full, hidden from search</Chip>}
              <Button variant="glass" size="sm" onClick={() => { setPosting(false); setEditingId(h.id); }}><Pencil className="size-4" aria-hidden />Edit listing</Button>
              {problem?.id === h.id && <p role="alert" className="w-full text-sm text-danger">{problem.message}</p>}
            </Panel>}
          </li>
        ))}
      </ul>
    </div>
  );
}
