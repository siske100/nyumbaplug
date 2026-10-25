import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPinOff } from "lucide-react";
import { viewingRequestSchema } from "@rh/shared";
import { api } from "@/api";
import { HouseLoader, PayCelebration } from "@/components/motion/Doodles";
import { Windows } from "@/components/motion/HouseScene";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CodeField } from "@/components/ui/CodeField";
import { Field, SelectField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { formatKes } from "@/lib/format";
import { useCooldown } from "@/lib/useCooldown";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Today and the next six days: always inside the server's seven-day rule, whatever the time zone. */
const dateOptions = () => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return { value: ymd(d), label: d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" }) }; });

function ViewingRequest({ houseId }: { houseId: string }) {
  const dates = useMemo(dateOptions, []);
  const [f, setF] = useState({ name: "", phone: "", date: dates[0]!.value, window: "Morning", code: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const cooldown = useCooldown();

  const send = useMutation({ mutationFn: () => api.site.sendVisitCode(f.phone), onSuccess: () => { setStep("code"); cooldown.start(60); } });
  const submit = useMutation({ mutationFn: () => api.site.requestVisit({ houseId, ...f }), onSuccess: () => setStep("done") });

  const start = () => {
    const r = viewingRequestSchema.safeParse(f);
    if (!r.success) { const e: Record<string, string> = {}; for (const i of r.error.issues) e[String(i.path[0])] ??= i.message; setErrs(e); return; }
    setErrs({});
    setF({ ...f, phone: r.data.phone });
    send.mutate();
  };

  if (step === "done") return <Panel className="p-6"><PayCelebration message="Request sent" /><p className="text-center text-graphite-300">We will contact you on WhatsApp at {f.phone} to confirm the time. Keep your phone on.</p></Panel>;
  return (
    <Panel tone="hero" className="grid gap-4 p-6">
      <h2 className="text-2xl">Request a viewing</h2>
      {step === "form" ? (
        <>
          <p className="text-graphite-300">Pick a day this week. We will text a code to confirm your number, then contact you on WhatsApp.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
            <Field label="WhatsApp number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} />
            <SelectField label="Day" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} error={errs.date}>{dates.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</SelectField>
            <SelectField label="Time of day" value={f.window} onChange={(e) => setF({ ...f, window: e.target.value })}>{["Morning", "Afternoon", "Evening"].map((w) => <option key={w}>{w}</option>)}</SelectField>
          </div>
          <ErrorNote error={send.error} />
          <Button magnetic loading={send.isPending} onClick={start}>Send me a code</Button>
        </>
      ) : (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (f.code.length === 6) submit.mutate(); }}>
          <p className="text-graphite-300">We texted a 6-digit code to {f.phone}. It expires in 5 minutes.</p>
          <CodeField label="Code from the SMS" value={f.code} onChange={(v) => setF({ ...f, code: v })} />
          <ErrorNote error={submit.error} />
          <Button type="submit" magnetic loading={submit.isPending} disabled={f.code.length !== 6}>Send my request</Button>
          <Button variant="ghost" disabled={cooldown.left > 0 || send.isPending} onClick={() => send.mutate()}>{cooldown.left > 0 ? `Send again in ${cooldown.left}s` : "Send a new code"}</Button>
          <Button variant="ghost" onClick={() => setStep("form")}>Change my details</Button>
        </form>
      )}
    </Panel>
  );
}

export default function House() {
  const { id = "" } = useParams();
  const { data: h, isPending, isError } = useQuery({ queryKey: ["listing", id], queryFn: () => api.site.house(id), staleTime: 60_000 });
  const [shot, setShot] = useState(0);

  if (isPending) return <HouseLoader label="Opening the house" />;
  if (isError || !h) return <Notice icon="missing" title="This house is no longer listed" body="It may be full now. Browse other vacant houses." action={{ to: "/", label: "Browse houses" }} />;

  return (
    <div className="grid gap-6">
      <Link to="/" className="text-sm text-graphite-300 hover:text-bone">← All houses</Link>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid gap-3">
          <div className="glass-quiet aspect-[4/3] overflow-hidden">
            {h.photos[shot] ? <img src={h.photos[shot]} alt={`${h.title}, photo ${shot + 1}`} className="size-full object-cover" /> : <div className="skeleton size-full" />}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {h.photos.map((p, i) => (
              <button key={p} onClick={() => setShot(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === shot} className={`size-16 shrink-0 overflow-hidden rounded-lg border ${i === shot ? "border-ember-400" : "border-white/10 opacity-70"}`}>
                <img src={p} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </div>
        <div className="grid content-start gap-4">
          <div>
            <h1 className="text-4xl">{h.title}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-graphite-300"><MapPinOff className="size-4" aria-hidden />{h.town}, {h.county}. The exact spot is sent on WhatsApp once your viewing is arranged.</p>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div><p className="font-display text-3xl">{formatKes(h.rent)}</p><p className="text-sm text-graphite-300">per month, deposit {formatKes(h.deposit)}</p></div>
            <div><Windows total={h.total} vacant={h.vacant} /><p className="mt-1 text-sm text-graphite-300">{h.vacant} of {h.total} vacant</p></div>
          </div>
          <div className="flex flex-wrap gap-1.5"><Chip>{h.type}</Chip><Chip tone="ok">Verified landlord</Chip>{h.amenities.map((a) => <Chip key={a}>{a}</Chip>)}</div>
          {(h.rules || h.electricityNote) && (
            <Panel className="grid gap-3 p-5 text-sm">
              {h.electricityNote && <div><p className="text-graphite-300">Electricity</p><p>{h.electricityNote}</p></div>}
              {h.rules && <div><p className="text-graphite-300">House rules</p><p>{h.rules}</p></div>}
            </Panel>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-2xl"><ViewingRequest houseId={h.id} /></div>
    </div>
  );
}
