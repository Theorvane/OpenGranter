# Current-principal recovery (#637 / #639)

1. Reproduce the Account/Audit dead end after a transient current-principal API failure. Add mounted-workspace RED tests before production edits.
2. Add an explicit Retry current principal control only on unavailable states. Keep 401/403 terminal and preserve bounded parsing/private errors. The host, not the view, retains authority.
3. Bind each control to its render lifetime; suppress repeat/detached clicks. Host must validate active view, grant expiry, generation and page lifecycle before any retry. Audit recovery must rerun current identity before audit access. No automatic retry or mutation replay.
4. Test success recovery, no automatic retries, expired/denied/renewed/navigation/pagehide/disposal cases and both Account and Audit integration.
5. Run focused tests, typecheck, lint, scripts, offline compatibility and actual public-entry build. Submit draft PR and request independent exact-HEAD review; no merge without all required CI and valid formal approval.

No session, CSRF, IAM, runtime, deployment, schema or paid-call change. Native browser/installed API evidence remains separate.
