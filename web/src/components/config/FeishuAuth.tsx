import { useCallback, useEffect, useState } from "react";
import { configApi } from "../../api/config";

type Phase =
  | "checking"
  | "not-installed"
  | "unauthorized"
  | "starting"
  | "awaiting"
  | "completing"
  | "ready"
  | "error";

/**
 * In-wizard Feishu authorization. Drives the lark-cli device flow entirely from the
 * browser (start → open verification URL → complete → poll status) so the user never
 * has to run `lark auth login` in a terminal. Replaces the old "run the CLI yourself"
 * prerequisite note.
 */
export function FeishuAuth() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [url, setUrl] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [userName, setUserName] = useState<string | undefined>();
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    try {
      const s = await configApi.feishuAuthStatus();
      if (s.notInstalled) {
        setPhase("not-installed");
        return false;
      }
      if (s.ready) {
        setUserName(s.userName);
        setPhase("ready");
        return true;
      }
      setPhase((p) => (p === "checking" ? "unauthorized" : p));
      return false;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const start = async () => {
    setPhase("starting");
    setError("");
    try {
      const r = await configApi.feishuAuthStart();
      if (r.notInstalled) {
        setPhase("not-installed");
        return;
      }
      if (r.error || !r.verification_url || !r.device_code) {
        setError(r.error ?? "Failed to start Feishu authorization.");
        setPhase("error");
        return;
      }
      setUrl(r.verification_url);
      setDeviceCode(r.device_code);
      setPhase("awaiting");
      window.open(r.verification_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const complete = async () => {
    setPhase("completing");
    setError("");
    await configApi.feishuAuthComplete(deviceCode).catch(() => ({ ok: false }));
    // The user token lands in the keychain a beat after completion — poll briefly.
    for (let i = 0; i < 6; i++) {
      if (await refreshStatus()) return;
      await new Promise((res) => setTimeout(res, 1000));
    }
    setPhase("awaiting");
    setError("Not authorized yet — finish the approval in the browser tab, then click again.");
  };

  if (phase === "checking") {
    return <p className="text-sm text-fg-muted">Checking Feishu authorization…</p>;
  }

  if (phase === "ready") {
    return (
      <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
        ✓ Feishu authorized{userName ? ` as ${userName}` : ""}. Your group chats will load on the
        next step.
      </div>
    );
  }

  if (phase === "not-installed") {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        The <code>lark</code> CLI isn't installed, so Feishu can't be connected. Install lark-cli
        and reload, or turn off "I use Feishu / Lark" above to skip — memkin still works with your
        AI-agent sessions.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {phase === "awaiting" ? (
        <div className="rounded border border-border-default bg-bg-subtle p-3 text-sm text-fg-default">
          <p className="mb-2">
            A Feishu authorization page should have opened. If not,{" "}
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              click here to open it
            </a>
            . Approve the request, then come back and click the button below.
          </p>
          <button
            type="button"
            onClick={complete}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-muted"
          >
            I've approved it — continue
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={phase === "starting" || phase === "completing"}
          className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:opacity-40"
        >
          {phase === "starting"
            ? "Starting…"
            : phase === "completing"
              ? "Verifying…"
              : "Authorize Feishu"}
        </button>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
