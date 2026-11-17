# SSO operations lifetime composition (#639, #637)

## Problem and scope
The existing approved-grant operations mount and explicit bearer adapter require the host to coordinate two lifetimes. Add a separate opt-in composition accepting only an already-approved API-specific SSO token, trusted expiry and same-origin fetch port. Mount Account, History and Token operations using existing contracts; logout, identity replacement, expiry and fresh server Deny must remove private UI and abort the outgoing bearer lifetime together.

## Design and boundaries
Keep frontend-owned entry and operations sources unchanged. Compose their public ports in sso-operations-host.ts. Never acquire or validate a credential, enable a public entry, persist secrets, refresh a login or change server IAM/audit. A trusted asynchronous scheduler owns local expiry, bounded to native timer range; stale callbacks cannot clear replacement authority. Cancellation does not roll back accepted mutations or revoke credentials. Company IdP/session acquisition remains unresolved, not inferred.

## TDD and delivery
First run behavior tests against a minimal stub: approved Account loading and identity, logout abort, replacement isolation, expiry, fresh Deny and scheduler failure must fail for expected behavior. Implement composition and rerun focused session/transport/host cases, strict tsc and lint/docs checks. Extend canonical HTTP/PGlite integration for actual Account rendering through composition, distinct from company IdP/native PostgreSQL/browser/installed acceptance. Report full-suite failures separately. Stack on PR968; no merge without exact-head CI and independent formal approval.
