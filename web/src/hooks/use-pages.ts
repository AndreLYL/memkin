import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function usePages(opts?: { type?: string; limit?: number; sort?: string; order?: string }) {
  return useQuery({
    queryKey: ["pages", opts],
    queryFn: () => api.pages(opts),
  });
}
