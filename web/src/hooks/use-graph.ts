import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useAllPages() {
  return useQuery({
    queryKey: ["pages", { limit: 0 }],
    queryFn: () => api.pages({ limit: 0 }),
  });
}

export function useAllLinks() {
  return useQuery({
    queryKey: ["allLinks"],
    queryFn: api.allLinks,
  });
}
