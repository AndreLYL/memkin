---
id: memkin-install
name: Install Memkin for this agent
version: 1
requires:
  - Node.js >= 18 (for npx / npm)
est_time: ~5 min
---

# Install Memkin (for AI agents)

**You are the installer. Follow these steps precisely.** Memkin is the user's
**local-first** personal memory (people, projects, decisions, tasks, history),
served over MCP. Everything stays on the user's machine.

> The core pattern: deterministic commands for setup, your judgment for the few
> choices. Run the commands; don't reimplement them.

## Step 1 — Confirm Memkin is available
```bash
npx memkin --help
```
If the user prefers a global binary: `npm install -g memkin`.

## Step 2 — Configure if needed
If there is no `memkin.yaml` yet, run the one-step setup (it launches the
browser setup wizard, then the server):
```bash
memkin start
```
If a config already exists, skip this step.

## Step 3 — Wire Memkin into THIS client
Identify which client you are running inside and register Memkin globally:
```bash
memkin install --agent <claude-code|claude-desktop|cursor|codex|windsurf|hermes>
# or, to auto-detect every installed client:
memkin install
```
This writes the MCP config + a minimal memory directive (global by default).

## Step 4 — (Claude Code only) enable automatic recall
```bash
memkin hooks install                # SessionStart + UserPromptSubmit (read hooks)
memkin hooks install --write-back   # also auto-capture at session end (opt-in)
```
Other clients rely on the memory directive from Step 3 (model-initiated recall).

## Step 5 — (optional) scaffold the skill
For workspaces that load skills (e.g. Hermes), drop the full capability doc:
```bash
memkin skill scaffold               # default ./.claude/skills
memkin skill scaffold --dir ~/.hermes/skills
```

## Step 6 — Verify
Ask Memkin to recall something, e.g. run a query or call the MCP tool `query`.
Then check health:
```bash
# via MCP: call the `get_health` tool
```
If `query` returns results and `get_health` is ok, the install succeeded.

## Reminders
- Local-first: memory never leaves the user's machine.
- Reopen the client after Step 3/4 for changes to take effect.
- To undo: `memkin uninstall` and `memkin hooks uninstall`.
