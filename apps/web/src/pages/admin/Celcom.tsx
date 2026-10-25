import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useAdminCelcom, useTopup } from "@/features/admin/hooks";
import { formatKes } from "@/lib/format";

export default function Celcom() {
  const { data, isPending, error } = useAdminCelcom();
  const topup = useTopup();
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [errs, setErrs] = useState<{ amount?: string; ref?: string }>({});

  const submit = () => {
    const n = Number(amount);
    const e: typeof errs = {};
    if (!(n > 0)) e.amount = "Enter the amount you topped up";
    if (ref.trim().length < 4) e.ref = "Enter the payment reference";
    setErrs(e);
    if (!e.amount && !e.ref) topup.mutate({ amount: n, ref: ref.trim() }, { onSuccess: () => { setAmount(""); setRef(""); } });
  };

  return (
    <div className="grid gap-4">
      <PageHead title="Celcom SMS" sub="Your platform credit. Verification codes and reminders use it at KES 0.25 a segment." />
      <ErrorNote error={error} />
      {data?.low && <Panel className="border-danger/35 p-4"><p className="font-medium text-danger">Credit is low</p><p className="text-sm text-graphite-300">Top up soon. If it reaches zero, verification codes stop and nobody can register.</p></Panel>}
      <Stats loading={isPending} items={[
        { label: "Estimated balance", value: formatKes(Math.round((data?.balance ?? 0) * 100) / 100), note: `about ${Math.floor((data?.balance ?? 0) / 0.25).toLocaleString()} segments`, tone: data?.low ? "warn" : "ok" },
        { label: "Sold this month", value: formatKes(Math.round(data?.monthRevenue ?? 0)), note: `${(data?.monthSegments ?? 0).toLocaleString()} segments at 0.80` },
        { label: "Your cost", value: formatKes(Math.round(data?.monthCost ?? 0)), note: "at 0.25" },
        { label: "Profit", value: formatKes(Math.round(data?.monthProfit ?? 0)), tone: "ok" },
      ]} />
      <p className="text-sm text-graphite-400">The balance is tracked from your top-ups and what the platform sends. Compare it with Celcom's own portal now and then.</p>
      <Panel className="grid gap-4 p-5 sm:p-6">
        <h2 className="text-xl">Record a top-up</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (KES)" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} error={errs.amount} />
          <Field label="Payment reference" value={ref} onChange={(e) => setRef(e.target.value)} error={errs.ref} hint="From your M-Pesa or Celcom receipt. Each reference works once." />
        </div>
        <ErrorNote error={topup.error} />
        <div><Button loading={topup.isPending} onClick={submit}>Record top-up</Button></div>
      </Panel>
    </div>
  );
}
