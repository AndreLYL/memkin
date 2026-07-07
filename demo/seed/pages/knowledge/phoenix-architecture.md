---
title: "Phoenix architecture: Next.js on Vercel with a Postgres backend"
type: knowledge
---
[[entities/project-phoenix]] is a Next.js app on [[entities/vercel]] with a Postgres
backend (per [[decisions/postgres-over-dynamodb]]). Billing is a separate service behind
the /v2 API ([[decisions/api-v2-versioning]]). Infra is [[entities/terraform]]-managed by
[[entities/bob-martinez]].
