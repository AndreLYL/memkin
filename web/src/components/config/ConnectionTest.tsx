import { useState } from "react";

type TestStatus = "idle" | "testing" | "ok" | "failed";

interface ConnectionTestProps {
  label?: string;
  onTest: () => Promise<{ ok: boolean; error?: string; latency_ms?: number }>;
}

export function ConnectionTest({ label = "Test Connection", onTest }: ConnectionTestProps) {
  const [status, setStatus] = useState<TestStatus>("idle");
  const [message, setMessage] = useState<string>("");

  const run = async () => {
    setStatus("testing");
    setMessage("");
    try {
      const result = await onTest();
      if (result.ok) {
        setStatus("ok");
        setMessage(result.latency_ms ? `${result.latency_ms}ms` : "Connected");
      } else {
        setStatus("failed");
        setMessage(result.error ?? "Connection failed");
      }
    } catch (err) {
      setStatus("failed");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const statusIcon = { idle: "", testing: "⏳", ok: "✓", failed: "✗" }[status];
  const statusColor = { idle: "", testing: "text-fg-muted", ok: "text-green-600", failed: "text-red-500" }[status];

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={status === "testing"}
        className="rounded border border-border-default px-3 py-1.5 text-sm text-fg-default hover:bg-bg-subtle disabled:opacity-50"
      >
        {status === "testing" ? "Testing..." : label}
      </button>
      {status !== "idle" && (
        <span className={`text-sm ${statusColor}`}>
          {statusIcon} {message}
        </span>
      )}
    </div>
  );
}
