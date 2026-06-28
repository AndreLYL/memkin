# SP4 Always-On Daemon — Manual Smoke Checklist

CI tests cover unit and hermetic integration scenarios. This checklist covers what CI
cannot: reboot persistence, OS launcher integration, agent tool-call round-trips, and
auto-restart after a kill.

**Gate**: every item must be checked ✓ before merging SP4 to main.

---

## Prerequisites

- Memoark config at `~/memoark.yaml` (or pass `--config`).
- For postgres engine: `DATABASE_URL` exported in the shell that runs `memoark up`.
- On Linux: `systemd --user` daemon running (standard on modern distros).
- On macOS: no `SIP` restrictions on `~/Library/LaunchAgents` (standard user installs).
- At least one agent installed: Claude Code, Codex, Cursor, or Windsurf.

---

## macOS (launchd)

### A. Fresh install

| # | Step | Expected | ✓ |
|---|------|----------|---|
| A1 | `memoark up` | Prints `✓ Memoark daemon running`, shows URL, port, engine, wired agents | |
| A2 | `launchctl print gui/$(id -u)/com.memoark.daemon` | Shows `state = running`, `pid = <n>` | |
| A3 | `curl -s http://127.0.0.1:3928/health \| jq` | `{"status":"ok","db_ok":true,"read_only":false,"engine":"..."}` | |
| A4 | `cat ~/.memoark/daemon.json` | Contains `instance_id`, `url`, `argv`, `raw_yaml_hash` | |
| A5 | `cat ~/Library/LaunchAgents/com.memoark.daemon.plist` | Valid XML plist, `Label` = `com.memoark.daemon`, `RunAtLoad` = true | |
| A6 | Open agent (e.g. Claude Code), call `put_page` via MCP | Tool call returns success; `get_page` confirms data persisted | |
| A7 | `memoark status` | Shows `running ✓`, correct URL and engine; no drift warnings | |

### B. Reboot persistence

| # | Step | Expected | ✓ |
|---|------|----------|---|
| B1 | **Reboot the machine** | — | |
| B2 | After login, wait ~10 s then `launchctl print gui/$(id -u)/com.memoark.daemon` | State = `running` (launchd re-launched it) | |
| B3 | `curl -s http://127.0.0.1:3928/health \| jq .db_ok` | `true` | |
| B4 | Open Claude Code, call `put_page` | Tool call succeeds | |

### C. Auto-restart after kill

| # | Step | Expected | ✓ |
|---|------|----------|---|
| C1 | Note PID: `cat ~/.memoark/daemon.json \| jq .pid` (or from health body) | — | |
| C2 | `kill -9 <pid>` | Process exits | |
| C3 | Wait 5–10 s | launchd respawns the daemon | |
| C4 | `launchctl print gui/$(id -u)/com.memoark.daemon` | New PID, state = `running` | |
| C5 | `curl -s http://127.0.0.1:3928/health \| jq .db_ok` | `true` | |

### D. Daemon down and agent revert

| # | Step | Expected | ✓ |
|---|------|----------|---|
| D1 | `memoark down` | Prints note about agent config preservation | |
| D2 | `launchctl print gui/$(id -u)/com.memoark.daemon` | Error / not found — service removed | |
| D3 | `ls ~/Library/LaunchAgents/com.memoark.daemon.plist` | File absent | |
| D4 | `ls ~/.memoark/daemon.json` | File absent | |
| D5 | `memoark uninstall` | Reverts each agent's MCP config back to stdio (or removes entry) | |
| D6 | Open Claude Code, verify memoark MCP entry is reverted to stdio (or absent) | | |

### E. Reconcile (re-up while already running)

| # | Step | Expected | ✓ |
|---|------|----------|---|
| E1 | While daemon is running, edit `~/memoark.yaml` (change a non-secret value) | — | |
| E2 | `memoark status` | Shows `⚠ Config changed since last up` | |
| E3 | `memoark up` (again) | Successfully reconciles: new daemon starts, agents re-wired to new URL/port if changed | |
| E4 | `memoark status` | No drift warnings | |

---

## Linux (systemd --user)

### F. Fresh install

| # | Step | Expected | ✓ |
|---|------|----------|---|
| F1 | `memoark up` | Prints `✓ Memoark daemon running`, URL, port, engine | |
| F2 | `systemctl --user status memoark.service` | `active (running)` | |
| F3 | `curl -s http://127.0.0.1:3928/health \| jq` | `{"db_ok":true,"read_only":false,...}` | |
| F4 | `cat ~/.memoark/daemon.json` | Contains `instance_id`, `url`, `argv` | |
| F5 | `cat ~/.config/systemd/user/memoark.service` | Valid unit file, `[Install] WantedBy=default.target` | |
| F6 | Open Codex or Claude Code, call `put_page` | Tool call returns success | |

### G. Reboot persistence (requires `--linger` or manual loginctl enable-linger)

| # | Step | Expected | ✓ |
|---|------|----------|---|
| G1 | `memoark up --linger` (or `loginctl enable-linger $USER` separately) | — | |
| G2 | `loginctl show-user $USER \| grep Linger` | `Linger=yes` | |
| G3 | **Reboot** | — | |
| G4 | After boot (no login needed), check: `systemctl --user --machine=$USER@ status memoark.service` | `active (running)` | |
| G5 | `curl -s http://127.0.0.1:3928/health \| jq .db_ok` | `true` | |

### H. Auto-restart after kill

| # | Step | Expected | ✓ |
|---|------|----------|---|
| H1 | `systemctl --user show memoark.service --property=MainPID` | Get PID | |
| H2 | `kill -9 <pid>` | Process exits | |
| H3 | Wait 5 s | systemd respawns (Restart=on-failure) | |
| H4 | `systemctl --user status memoark.service` | New PID, `active (running)` | |

### I. Daemon down

| # | Step | Expected | ✓ |
|---|------|----------|---|
| I1 | `memoark down` | Prints success note | |
| I2 | `systemctl --user status memoark.service` | `Unit memoark.service could not be found` or `inactive (dead)` | |
| I3 | `ls ~/.config/systemd/user/memoark.service` | File absent | |
| I4 | `memoark uninstall` | Reverts agent configs | |

---

## Cross-platform: Agent tool-call round-trip

Run this on both macOS and Linux after a successful `memoark up`:

| # | Step | Expected | ✓ |
|---|------|----------|---|
| X1 | **Claude Code**: open a project, send a message that triggers memory write | MCP `put_page` call succeeds, data in response | |
| X2 | **Claude Code**: open a different project, query the same page | MCP `get_page` returns data written in X1 | |
| X3 | **Codex** (if installed): same write/read round-trip | Same results | |
| X4 | **Cursor** (if installed): verify MCP entry is HTTP, not stdio | Entry in `~/.cursor/mcp.json` has `type: "http"` and `url` matching daemon | |

---

## Notes for reviewer

- If `memoark up` fails with "Cannot resolve daemon runtime", run via `bun src/cli.ts up` (dev) or build first.
- The `--linger` flag on `memoark up` calls `loginctl enable-linger` behind the scenes (Linux only; no-op on macOS).
- Agent config rollback (`memoark uninstall`) restores the `original` captured in `install-state.json`, not a hard-coded default.
- `daemon.json` intentionally contains NO secrets — it stores only the hash of the YAML, not the YAML content.
