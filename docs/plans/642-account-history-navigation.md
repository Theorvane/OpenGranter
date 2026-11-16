# Account-scoped history navigation (#637, #642)

1. Preserve existing session, authentication, authorization and read-only API contracts. Do not activate browser login or infer read grants from Account identity.
2. Add an optional Account action that opens history for the exact validated principal ID. Capture identity in the current panel epoch; refresh/navigation/disposal invalidate detached actions.
3. Initialize usage and audit filters with this ID and load usage using the existing authenticated history client. Reject IDs outside the history-query contract locally without falling back to an unfiltered request. Keep manual History navigation unchanged and filters editable; tab changes and CSV use the selected filters.
4. Clear retained filter controls on redraw/disposal. Never preserve the account default across a manual navigation.
5. First run failing public DOM regressions, then implement the three owned modules. Run existing operations/history/token regressions and signed synthetic JWT + owned HTTP + migrated PGlite cases for success, fresh Deny and required audit failure. These are not installed PostgreSQL, browser login or live deployment evidence.
6. Commit as sjungwon03, open a stacked draft PR against 947's branch, request exact-head review, and require all required CI plus valid independent formal approval before any merge. Original whole PRD remains open.

Acceptance: Account -> View history for this account sends exact principal_id to usage and audit; 401/403 clears operations; 503 shows retry without private text; invalid history IDs cause no history request; stale controls do nothing; manual History has no retained default. No endpoint/schema/policy/session/paid call changes.
