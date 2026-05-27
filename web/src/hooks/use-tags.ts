import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useTags(slug: string) {
  return useQuery({
    queryKey: ["tags", slug],
    queryFn: () => api.tags(slug),
    enabled: !!slug,
  });
}
