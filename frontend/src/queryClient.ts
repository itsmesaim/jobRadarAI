import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** Drop cached jobs/kanban when the signed-in user changes. */
export function clearUserScopedCache() {
  queryClient.removeQueries({ queryKey: ["jobs"] });
  queryClient.removeQueries({ queryKey: ["kanban"] });
  queryClient.removeQueries({ queryKey: ["crawl-status"] });
}
