# Current-page token usage summary (#642)

1. Extend the existing authorized usage-page summary. No new endpoint, session, schema, IAM or provider changes.
2. Independently sum known prompt, completion and total counters with exact integer arithmetic and per-counter coverage. Missing is unknown, never zero or inferred. Keep explicit zero, partial reports, duplicates and current-page boundaries. These are reported counters, not reconciled usage or an invoice.
3. RED: mounted source and supported browser artifact must cover partial, missing, invalid and zero counters, integer overflow, duplicates, replacement, empty pages, clear and disposal without additional reads.
4. GREEN: render aggregates in the existing lifecycle-owned summary; run focused tests, typecheck, lint, planning checks and full check.
5. Deliver exact-head PR; require independent formal review and CI plus parent gates before merge. Artifact tests are not native-browser or installed SSO evidence.
