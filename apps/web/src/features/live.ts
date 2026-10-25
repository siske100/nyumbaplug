import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/useSession";

type Scope = "landlord" | "tenant";

/** One query hook for every landlord and tenant screen. Keys include the user id so two accounts never share a cache entry. */
export function useLive<T>(scope: Scope, name: string, fn: () => Promise<T>, opts: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  const uid = useSession().data?.userId ?? "";
  return useQuery({ queryKey: [scope, uid, name], queryFn: fn, enabled: !!uid && opts.enabled !== false, staleTime: 10_000, refetchInterval: opts.refetchInterval });
}

/** After any change, everything this person is looking at is refreshed, and public search too. Writes are never retried. */
export function useLiveMutation<V, R = void>(scope: Scope, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  const uid = useSession().data?.userId ?? "";
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: [scope, uid] }), qc.invalidateQueries({ queryKey: ["listings"] })]);
    },
  });
}
