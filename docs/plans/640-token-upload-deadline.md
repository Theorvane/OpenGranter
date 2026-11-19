# Bounded token mutation uploads (#640)

1. Reproduce authenticated issue/revoke JSON streams without EOF: the byte limit cannot bound lifetime.
2. Bound the entire body read to 30 seconds after authentication, not a sliding per-chunk timer. Preserve authentication-before-body, 16 KiB limit, strict UTF-8, exact request shapes, fresh IAM and durable audit.
3. Deadline returns existing private 400 invalid_request, cancels without awaiting producer cleanup, releases reader and never mutates from partial or late bytes. Valid complete input retains behavior.
4. RED/GREEN via public handler with deterministic time and unfinished real HTTP uploads; verify late data, abort, authentication denial, timer cleanup and existing regressions.
5. No new grant/session/browser activation/deployment/DDL. Require exact-head full required CI and independent formal approval before merge.

## Canonical integration 2026-11-20 03:30 KST

- Reconcile the existing #959 branch (including already merged #960 usage-to-audit navigation) with current #958, preserving canonical main/UI, Account, client mutation deadlines, durable audit, process configuration validation and disconnected-response cleanup. Keep the server upload deadline distinct from the client uncertain-outcome deadline; never imply cancellation reverses a committed mutation.
- Verify public issue/revoke handler deadlines together with actual socket uploads, token client uncertainty, canonical operations HTTP/SQL and usage-to-audit navigation on the integrated tree. Run the full standard check and preserve parent-before-child and independent exact-head approval gates.
- This is source integration only: no session/cookie/IdP contract, DDL, bootstrap activation, deployment, paid calls or installed acceptance changes.
