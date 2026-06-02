import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useSSE() {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;

    es.addEventListener("signal:new", () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["pages"] });
      qc.invalidateQueries({ queryKey: ["timelineFeed"] });
    });

    es.addEventListener("pipeline:end", () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    });

    return () => es.close();
  }, [qc]);
}
