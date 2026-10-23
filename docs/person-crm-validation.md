# Person CRM validation

Validation for [PR #139](https://github.com/AndreLYL/memkin/pull/139), performed on
2026-10-24 (Asia/Shanghai), with synthetic data and frozen-lockfile dependencies.

## Automated checks

- Complete local regression run at implementation checkpoint `8cd2bfd`:
  **2207 passed, 8 skipped, zero failures**, 306 test files, normal process exit 0.
  Command: `npx vitest run --maxWorkers=2 --minWorkers=1` (JSON reporter used to
  retain individual assertion results). Vitest 1's JSON top-level passed counter
  includes skipped assertions; the numbers here count actual assertion statuses.
- After the final source-boundary, graph-status, validity and precision fixes:
  **25 CRM tests passed** (`npx vitest run tests/crm --maxWorkers=1 --minWorkers=1`).
- MCP contract and legacy person identity/resolution checks pass; backend and web
  TypeScript checks and production builds pass. Biome succeeds with existing
  repository warnings.
- The 8 skips require `MEMKIN_TEST_PG_URL`: PostgreSQL connectivity/executor,
  concurrent writes and concurrent migration/bootstrap. PGlite storage, migration
  and transaction behavior are exercised locally.

## Production runtime and browser

- Start the built Node CLI against an isolated, disk-backed PGlite directory with
  all collection sources disabled. No real personal data or model credentials.
- Desktop Chromium: create a profile with aliases, a yearless June 12 birthday
  and a synthetic phone number; capture a voice transcript at
  `2026-10-03T19:07:00+08:00`; verify missing-model feedback after source persistence.
- Manually organize a previous-day interaction with two topics and a planned
  November move. Independently filter event time and original capture time;
  correct the plan and inspect revision 2 and its previous value.
- Verify the planned move never populates the current profile's address list.
- Mobile Chromium at 390px: no horizontal overflow, navigation closes after a
  route selection and Escape, and person profiles remain readable.
- Stop and restart the production CLI: profile, exact original source/timestamp,
  both entries and correction history remain unchanged.
- Real MCP SDK client over production CLI stdio: initialize and list 12 CRM tools,
  read that same persisted person and source, recall by person/topic/capture time,
  and receive `UNAVAILABLE` from extraction when no real provider is configured.
- Browser pagination fixture: 101 timeline entries and 101 source records remain
  reachable through the respective “load more” controls.

## Limits

Real LLM extraction quality has not been evaluated. The configured validation
provider is deliberately `mock`; CRM treats it as unavailable. The private golden
dataset and three-run holdout evaluation required by CONTRIBUTING.md are absent.
Functional synthetic tests do not substitute for that quality gate.

The repository's existing CI test wrapper treats a 300-second timeout as success
and emits a forced-exit warning. The initial PR CI run hit that timeout without a
complete suite summary. A green Test check alone is therefore insufficient
evidence of completion; the normally completed local regression and focused
checks above supply that evidence. This PR does not change the CI timeout policy.

CRM data requires a full database backup. A Markdown vault export is a derived
view and does not include the immutable sources, structured rows and audit history.
