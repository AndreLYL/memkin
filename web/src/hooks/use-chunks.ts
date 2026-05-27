import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useChunks(slug: string) {
  return useQuery({
    queryKey: ["chunks", slug],
    queryFn: () => api.chunks(slug),
    enabled: !!slug,
  });
}
