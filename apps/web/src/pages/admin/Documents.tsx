import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useAdminKyc, useKycFileUrl, useReviewKyc } from "@/features/admin/hooks";

const CHECKS = ["The photos are clear and look unedited", "The name matches on the ID and the KRA certificate", "The details match the registration"];

function FilePreview({ label, path }: { label: string; path: string }) {
  const url = useKycFileUrl(path);
  const isPdf = path.toLowerCase().endsWith(".pdf");
  return (
    <div className="rounded-xl border border-white/10 bg-white/4 p-3">
      <p className="mb-2 text-sm text-graphite-300">{label}</p>
      {url.isPending ? <div className="skeleton h-40" /> : url.isError || !url.data ? <p className="text-sm text-danger">Could not open this file.</p>
        : isPdf ? <a href={url.data} target="_blank" rel="noopener noreferrer" className="text-ember-300 underline-offset-4 hover:underline">Open the PDF</a>
        : <a href={url.data} target="_blank" rel="noopener noreferrer"><img src={url.data} alt={label} className="max-h-56 w-full rounded-lg object-contain" /></a>}
    </div>
  );
}

export default function Documents() {
  const queue = useAdminKyc();
  const review = useReviewKyc();
  const [selected, setSelected] = useState<string | null>(null);
  const [ticks, setTicks] = useState<boolean[]>([false, false, false]);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string>();

  const items = queue.data ?? [];
  const current = items.find((k) => k.id === selected) ?? items[0];

  const choose = (id: string) => { setSelected(id); setTicks([false, false, false]); setReason(""); setProblem(undefined); review.reset(); };
  const decide = (approve: boolean) => {
    if (!current) return;
    if (approve && !ticks.every(Boolean)) { setProblem("Tick all three checks before approving."); return; }
    if (!approve && !reason.trim()) { setProblem("Write a reason so the landlord knows what to fix."); return; }
    setProblem(undefined);
    review.mutate({ id: current.id, approve, reason: reason.trim() || undefined }, { onSuccess: () => { setSelected(null); setTicks([false, false, false]); setReason(""); } });
  };

  return (
    <div className="grid gap-4">
      <PageHead title="Documents" sub="Review each landlord's ID and KRA certificate before they can go live. Files open as one-minute links." />
      <ErrorNote error={queue.error} />
      {queue.isPending && <div className="skeleton h-32" />}
      {queue.data && items.length === 0 && <Panel className="p-8 text-center text-graphite-300">No submissions waiting.</Panel>}

      {current && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Panel className="p-3">
            <p className="px-2 pb-2 pt-1 text-sm text-graphite-300">Waiting ({items.length})</p>
            {items.map((k) => (
              <button key={k.id} onClick={() => choose(k.id)} className={`w-full rounded-xl px-3 py-2.5 text-left ${k.id === current.id ? "bg-white/10" : "hover:bg-white/6"}`}>
                <p className="font-medium">{k.name}</p>
                <p className="text-sm text-graphite-300">{k.phone} · attempt {k.attempt} of 3</p>
              </button>
            ))}
          </Panel>

          <Panel className="grid gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="text-2xl">{current.name}</h2><p className="text-sm text-graphite-300">{current.email} · {current.phone}</p></div>
              <Chip tone="ember">Attempt {current.attempt} of 3</Chip>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/4 p-3"><p className="text-sm text-graphite-300">National ID number</p><p className="font-display text-xl">{current.nationalId}</p></div>
              <div className="rounded-xl border border-white/10 bg-white/4 p-3"><p className="text-sm text-graphite-300">KRA PIN</p><p className="font-display text-xl">{current.kraPin}</p></div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <FilePreview label="ID, front" path={current.frontPath} />
              <FilePreview label="ID, back" path={current.backPath} />
              <FilePreview label="KRA certificate" path={current.kraPath} />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm text-graphite-300">Your checks</legend>
              {CHECKS.map((c, i) => (
                <label key={c} className="flex items-center gap-3"><input type="checkbox" className="size-4 accent-[#f28c28]" checked={ticks[i]} onChange={(e) => setTicks(ticks.map((t, k) => (k === i ? e.target.checked : t)))} />{c}</label>
              ))}
            </fieldset>
            <Field label="Reason (required if you reject)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ID photo is blurry" />
            {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
            <ErrorNote error={review.error} />
            <div className="flex gap-2">
              <Button loading={review.isPending} onClick={() => decide(true)}>Approve</Button>
              <Button variant="glass" disabled={review.isPending} onClick={() => decide(false)}>Reject</Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
