---
title: "Use Postgres over DynamoDB for the billing service"
type: decision
---
[[entities/bob-martinez]] evaluated both for the Phoenix billing service and picked
Postgres: relational integrity for invoices matters more than single-digit-millisecond
reads, and the team already operates Postgres well. Documented in
[[knowledge/phoenix-architecture]].
