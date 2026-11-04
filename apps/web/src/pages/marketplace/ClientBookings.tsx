import { Link } from "react-router-dom";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

function statusLabel(status: string) {
  if (status === "awaiting_payment") return "Waiting for M-Pesa payment";
  if (status === "paid") return "Paid — confirm after viewing";
  if (status === "viewed") return "Viewing confirmed — pending month-end payout";
  if (status === "paid_out") return "Viewing confirmed";
  return "Refund sent to booking phone";
}

export default function ClientBookings() {
  const bookings = useLive("tenant", "marketplace-client-bookings", () => api.marketplace.clientBookings(), { refetchInterval: 8000 });
  const pay = useLiveMutation("tenant", (v: { id: string; amount: number }) => api.marketplace.payViewingFee(v.id, v.amount));
  const confirm = useLiveMutation("tenant", (id: string) => api.marketplace.confirmViewing(id));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-4">
      <PageHead title="My viewing bookings" sub="Track M-Pesa payments, confirm completed viewings, and see refund or settlement status." action={<Link to="/marketplace"><Button variant="glass" size="sm">Browse houses</Button></Link>} />
      <ErrorNote error={bookings.error ?? pay.error ?? confirm.error} />
      {bookings.data?.length === 0 && <Panel className="p-6 text-graphite-300">You have no bookings yet. <Link to="/marketplace" className="text-ember-300 underline">Browse houses</Link>.</Panel>}
      <div className="grid gap-3">
        {bookings.data?.map((b) => {
          const canPay = b.status === "awaiting_payment" && b.paymentStatus !== "pending";
          const canConfirm = b.status === "paid" && b.date <= today;
          return (
            <Panel key={b.id} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <h2 className="text-lg font-medium">{b.listingTitle}</h2>
                <p className="text-sm text-graphite-300">{b.town}, {b.county} · {b.date} · {b.timeWindow}</p>
                <p className="mt-1 text-sm text-graphite-400">Marketer: {b.marketerName} · Fee {formatKes(b.amount)}</p>
                {b.status === "paid" && b.date > today && <p className="mt-1 text-sm text-graphite-300">After the in-person viewing, return here to confirm whether you viewed the house.</p>}
                {b.status === "paid" && b.date < today && <p className="mt-1 text-sm text-ember-300">Confirm by the end of this month. Unconfirmed bookings are refunded, not paid to the marketer.</p>}
              </div>
              <div className="grid justify-items-start gap-2 sm:justify-items-end">
                <Chip tone={b.status === "viewed" || b.status === "paid_out" ? "ok" : b.status === "refunded" ? "danger" : "neutral"}>{statusLabel(b.status)}</Chip>
                {b.status === "paid" && <Chip>{b.paymentReceipt ? `M-Pesa ${b.paymentReceipt}` : "Payment confirmed"}</Chip>}
                {canPay && <Button size="sm" loading={pay.isPending} onClick={() => pay.mutate({ id: b.id, amount: b.amount })}>Pay {formatKes(b.amount)}</Button>}
                {canConfirm && <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate(b.id)}>Confirm I viewed this house</Button>}
                {b.status === "refunded" && <p className="text-xs text-graphite-400">Refund sent to {b.phone}</p>}
              </div>
              <p className="text-xs text-graphite-500 sm:col-span-2">Booked {fmtDate(b.submittedAt)}</p>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
