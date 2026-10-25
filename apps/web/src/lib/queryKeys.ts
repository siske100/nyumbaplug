import type { ListingFilters } from "@/api/types";

/** One place for every key. Private keys include the user id so two accounts can never share a cache entry. */
export const qk = {
  session: ["session"] as const,
  listings: (filters: ListingFilters) => ["listings", filters] as const,
  listingsAll: ["listings"] as const,
  admin: {
    landlords: (u: string) => ["admin", u, "landlords"] as const,
    kyc: (u: string) => ["admin", u, "kyc"] as const,
    payments: (u: string) => ["admin", u, "payments"] as const,
    celcom: (u: string) => ["admin", u, "celcom"] as const,
    viewings: (u: string) => ["admin", u, "viewings"] as const,
    all: (u: string) => ["admin", u] as const,
  },
  landlord: {
    summary: (userId: string) => ["landlord", userId, "summary"] as const,
    houses: (userId: string) => ["landlord", userId, "houses"] as const,
  },
};
