import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import type { ListingFilters } from "@/api/types";
import { qk } from "@/lib/queryKeys";

/** Public search. keepPreviousData keeps the old results on screen while a new filter loads, so the page never flashes empty. */
export function useListings(filters: ListingFilters) {
  return useQuery({
    queryKey: qk.listings(filters),
    queryFn: () => api.listListings(filters),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
