import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/queryClient";
import { qk } from "@/lib/queryKeys";

/** The email was confirmed with Auth but our record has not caught up yet (for example the connection dropped). */
export function EmailStep() {
  const qc = useQueryClient();
  const sync = useMutation({ mutationFn: () => api.syncEmailVerified(), onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }) });
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl">Finish confirming your email</h2>
        <p className="mt-1 text-graphite-300">Your email code was accepted. Continue to the next setup step.</p>
      </div>
      {sync.error instanceof ApiError && <p role="alert" className="text-sm text-danger">{sync.error.message}</p>}
      <Button loading={sync.isPending} onClick={() => sync.mutate()}>Continue</Button>
    </div>
  );
}
