# #640 Browser token administration transport

1. Reuse the existing SSO management HTTP issue/revoke contract without session activation, new permissions, schema or listener. Capture only a trusted request port.
2. Validate exact operation inputs before dispatch; snapshot inputs, use no-store, redirect:error, credentials:omit, and bounded fatal UTF-8 JSON responses. Return only the one-time projected secret to the caller; never persist, log or cache credentials.
3. Serialize mutations per client. Never retry automatically. Transport loss, timeout, cancellation after dispatch, malformed success and 5xx are outcome_unknown, not proof of rollback; the client locks further mutations and operators must reconcile before creating another client. Explicit 400/401/403 are separate states. Dispose aborts pending work and rejects later actions without leaking a late secret.
4. Prove missing-client RED, implement GREEN against actual loopback SSO management HTTP, and test validation, lost responses, uncooperative ports, double submission, revocation false, disposal and private errors. Test authority is synthetic and not native browser, IdP, installed SQL or live deployment acceptance.
5. Require exact-head CI and independent formal approval before merge. Frontend owns subsequent UI; session/CSRF/IdP decisions remain held.

## Local evidence

- Missing client import produced RED (0 pass / 1 failed file; ERR_MODULE_NOT_FOUND).
- Implemented source and supported artifact: 14 client tests pass, including deadline and unknown-outcome lock. Focused client + signed HTTP/embedded SQL + existing SSO management regressions: 262 pass / 0 fail / 0 skipped. Actual credential verification and revocation, current IAM Deny and failed durable decision audit are exercised without activating a runtime.
- Typecheck, repository lint, scripts/contracts/link checks, pinned compatibility and diff whitespace checks pass. Existing repository lint warnings/infos remain. CI and independent formal review remain required; no native browser, installed SQL or live-provider result is asserted.
