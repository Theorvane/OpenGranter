# Expiring catalog authority adapter (#639)

## 1. Scope and contract

Implement the missing trusted-session-to-catalog lifecycle adapter, not an authenticator. A trusted caller supplies an already-authorized request port and an absolute expiry in epoch milliseconds. No browser credentials, cookies, token bridge, DOM, persistence, provider calls or permission changes. Server authentication and IAM remain authoritative for every request.

## 2. Acceptance

Reject invalid/already-expired grants and drop previous data immediately. Expire automatically, cancel pending reads, notify the renderer and never publish results past expiry even if the timer was delayed. Recheck expiry before navigation and snapshot access. Renewals invalidate old timers and responses; logout/denial/disposal cancel timers. Publish loading and settled safe snapshots. Long lifetimes use bounded timer segments instead of overflowing platform timers. Observer failure must not retain authority or expose private errors.

## 3. RED/GREEN and delivery

Write contract tests first and execute missing-module RED. Implement only src/management/catalog-authority.ts. Run authority/session/transport/real local HTTP tests, typecheck, lint, scripts validation and diff check. This is local evidence, not browser SSO, installed or live-provider certification. Require exact-head full CI and independent formal approval before merge. Roll back this isolated adapter if necessary. Frontend owns DOM and backend owns authentication/session ingress.

## 4. Local execution evidence

Node 22.23.4 ARM64: missing-module RED captured in /tmp/og-1100-authority-red.log. Focused authority/session/transport/localhost-HTTP suite: 28 pass, 0 fail, 0 skip (/tmp/og-1100-authority-green.log). Initial implementation run was 25/26: the failed assertion incorrectly required aborting a transport which had already completed; corrected that expectation and added a separate in-flight abort test. Full TypeScript passed; Biome reports no errors with existing 42 warnings/145 infos; scripts/check.py and diff check passed. Controlled clock tests cover delayed/early/long timers and stale completion; one platform timer test uses a controlled clock to avoid wall-time flakiness. No browser/installed/provider execution was performed.

## 5. Consumer integration

Create once with onChange(snapshot) rendering the current view. Only the trusted session owner may call authorize({request, expiresAt}); never infer this grant from GET /management/v1/me or a browser-supplied principal/expiry. Call clear(unauthenticated) on logout and dispose on unmount. Loading and completion changes are both published; rendering must replace rather than append prior protected data. Server-side session revocation and fresh IAM remain mandatory. A renderer failure is contained but must be handled by the host UI; this component cannot erase DOM it does not own.
