# 640 Issued-token revocation handoff

1. Goal: connect the existing canonical issuance success to an explicit revocation review using only its exact credential ID. Preserve existing manual revocation and server authentication, IAM, lifetime, audit and mutation contracts.
2. Before implementation add failing interaction tests for no automatic mutation, exact escaped IDs, clearing even detached issued-secret nodes, cancel/stale controls, pending revocation, disposal and fresh denial. Then implement a caller-owned review port and compose the panels.
3. A successful explicit handoff clears the issued secret before returning, invalidates older confirmation controls and focuses the new review. Confirmation remains a separate user action; cancel/clear cannot undo issuance or revoke. A pending revocation cannot be replaced; keep the one-time secret until handoff succeeds and show a safe busy message. No raw bearer is handed to revocation.
4. Verify focused and existing management tests, strict types, lint and planning checks. Exercise the same UI against actual loopback SSO HTTP with explicit synthetic credentials; distinguish this from real IdP, durable installed database and user deployment acceptance.
5. Open a PR, require exact-head full CI and valid formal approval before merge. No public entry/session, policy, schema, production or paid-provider activation.

6. Completion: preserve the labelled revocation region and heading throughout confirmation and pending states. Focus the explicit confirmation without triggering it; test semantic region discovery in addition to lifecycle and HTTP outcomes.

## Local completion evidence (2026-11-15)

- Preserved the earlier unpublished handoff changes from /tmp/og-20261113-2300 without modifying that worktree; completed region/focus accessibility in a separate main-based worktree.
- RED: labelled confirmation-region interaction failed before completion (8 pass, 1 fail). GREEN: issuance/revocation/shared-token/operations regressions 78/78 pass, no skips. Strict TypeScript and full Biome checks pass (existing informational/warning diagnostics remain); planning/links/secret scan and six offline schema pins pass.
- Native browser built through the canonical browser builder, synthetic loopback HTTP only: issued credential issued/+@雪; review removed the one-time token and showed exact ID; server counters remained issued=1/revoked=0 until separate confirmation, then issued=1/revoked=1. Temporary browser entry removed.
- Full test run is tracked separately; no complete-suite success is claimed here. Live IdP, installed PostgreSQL, public user URL, real IAM/provider and paid traffic are not certified by these synthetic handlers.
