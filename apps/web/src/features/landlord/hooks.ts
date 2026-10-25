import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { LandlordHouse } from "@/api/types";
import { useSession } from "@/features/auth/useSession";
import { qk } from "@/lib/queryKeys";

export function useLandlordSummary() {
  const { data: session } = useSession();
  const id = session?.userId ?? "";
  return useQuery({ queryKey: qk.landlord.summary(id), queryFn: () => api.landlord.summary(), enabled: !!session });
}

export function useLandlordHouses() {
  const { data: session } = useSession();
  const id = session?.userId ?? "";
  return useQuery({ queryKey: qk.landlord.houses(id), queryFn: () => api.landlord.houses(), enabled: !!session });
}

/**
 * Optimistic update: the counter moves instantly, rolls back if the server refuses,
 * and every screen that shows this number is refreshed once the server has answered.
 */
export function useSetVacantUnits() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const id = session?.userId ?? "";
  const key = qk.landlord.houses(id);

  return useMutation({
    mutationFn: ({ houseId, vacant }: { houseId: string; vacant: number }) => api.landlord.setVacantUnits(houseId, vacant),
    onMutate: async ({ houseId, vacant }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<LandlordHouse[]>(key);
      qc.setQueryData<LandlordHouse[]>(key, (old) => old?.map((h) => (h.id === houseId ? { ...h, vacant } : h)));
      return { previous };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.previous) qc.setQueryData(key, ctx.previous); },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: qk.landlord.summary(id) });
      void qc.invalidateQueries({ queryKey: qk.listingsAll }); // public search must reflect it too
    },
  });
}
