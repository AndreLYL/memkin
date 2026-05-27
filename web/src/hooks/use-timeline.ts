import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useTimeline(slug: string) {
  return useQuery({
    queryKey: ["timeline", slug],
    queryFn: () => api.timeline(slug),
    enabled: !!slug,
  });
}
