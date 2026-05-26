import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useLinks(slug: string) {
  return useQuery({
    queryKey: ["links", slug],
    queryFn: () => api.links(slug),
    enabled: !!slug,
  });
}

export function useBacklinks(slug: string) {
  return useQuery({
    queryKey: ["backlinks", slug],
    queryFn: () => api.backlinks(slug),
    enabled: !!slug,
  });
}
