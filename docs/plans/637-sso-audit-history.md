# SSO gateway audit history (#637, #642)

1. Reuse the existing gateway audit metadata reader, query grammar, projection and CSV contract. This is NOT SSO-management event history or content retention.
2. Verify registered-key RFC9068 SSO and current human binding/IAM on every read; require audit:Read on principal:<target> for both omitted/self and explicit targets. Do not invent proxy credentials for the SSO actor.
3. Expose an opt-in Bearer-only GET /management/v1/audit handler/server factory. Reuse time/model filters and decimal event-ID keyset pagination. No mount, cookie/session, runtime or schema activation.
4. Require an injected awaited SSO-specific durable audit writer. Record actor, target, policy versions, request ID, outcome and count; withhold all results if it fails. Integration must provide an approved store before mounting.
5. First run acceptance tests RED without production modules; then implement and run signed JWT -> real HTTP -> disposable PGlite acceptance for self/target permissions, Deny, current IAM/binding, filters/cursors, empty and CSV, SQL failure and audit failure/await. Typecheck/lint/scripts and independent exact-head review/CI gate apply.
6. Keep installed PostgreSQL, company IdP/session, native browser, approved durable SSO audit wiring and provider E2E explicitly unverified. Do not change owned frontend files or other worktrees.
