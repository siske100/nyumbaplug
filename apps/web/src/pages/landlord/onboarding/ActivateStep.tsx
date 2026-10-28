import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { priceForUnits } from "@rh/shared";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/PageHead";
import { qk } from "@/lib/queryKeys";
import { formatKes } from "@/lib/format";

/** The last step: the first subscription payment by M-Pesa. The account switches on when M-Pesa confirms. */
export function ActivateStep() {
  const qc = useQueryClient();
  const price = priceForUnits(0);                    // no houses yet
  const [waiting, setWaiting] = useState(false);
  const pay = useMutation({ mutationFn: () => api.landlord.pay("subscription", price), onSuccess: () => setWaiting(true) });

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void qc.invalidateQueries({ queryKey: qk.session }), 4000);
    const stop = setTimeout(() => setWaiting(false), 3 * 60_000);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [waiting, qc]);

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-2xl">You are verified</h2>
        <p className="mt-1 text-graphite-300">Pay your first month to switch on your account: {formatKes(price)} covers up to 20 houses, and each extra house adds KES 25 a month. You will get an M-Pesa prompt on your verified phone.</p>
      </div>
      <ErrorNote error={pay.error} />
      {waiting && <p role="status" className="text-ember-300">Check your phone and enter your M-Pesa PIN. This page updates by itself.</p>}
      <Button magnetic loading={pay.isPending} disabled={waiting} onClick={() => pay.mutate()}>{waiting ? "Waiting for M-Pesa..." : `Pay ${formatKes(price)} with M-Pesa`}</Button>
      {!waiting && pay.isSuccess && <p className="text-sm text-graphite-300">Nothing happened? You can try again. You are only charged once the PIN is entered.</p>}
    </div>
  );
}
