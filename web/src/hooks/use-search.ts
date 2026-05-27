import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => api.query(query),
    enabled: query.length > 0,
  });
}
