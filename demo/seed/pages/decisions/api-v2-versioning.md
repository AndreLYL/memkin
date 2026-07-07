---
title: "Version the public API with /v2 path prefixes"
type: decision
---
The self-serve signup flow needs breaking changes to the accounts API. Rather than
mutating v1, new endpoints ship under a /v2 path prefix. Keeps existing integrations
stable through the [[entities/project-phoenix]] launch window.
