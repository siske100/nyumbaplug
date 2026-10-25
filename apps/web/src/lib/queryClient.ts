import { QueryCache, QueryClient } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const NEVER_RETRY = new Set([400, 401, 403, 404, 409, 422]);
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // A 401 anywhere means the session is gone: wipe every cached private result.
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000, // private data does not linger in memory
      retry: (count, error) =>
        !(error instanceof ApiError && NEVER_RETRY.has(error.status)) && count < 2,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false }, // never repeat a write automatically
  },
});
