# Current-page model usage summaries (#642)

1. Group only authorized validated page rows by exact modelAlias. No API, session, deployment, provider call or identity expansion.
2. Reuse exact cost/token summaries per expandable model; preserve unknowns, duplicates, currency separation and estimated/reported distinctions. Label page-only, not invoices or reconciliation.
3. Prove RED/GREEN for source and supported browser artifact: aliases, precision, missing/zero, replacement, no extra fetches, clear/dispose and late completion.
4. Run focused integration, typecheck, lint, planning and full checks. Require exact-head CI, independent formal approval and parent gates before merge. Native browser and installed IdP acceptance remain separate.
