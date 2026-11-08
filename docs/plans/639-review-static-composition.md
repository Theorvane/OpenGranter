# Same-origin source-only review composition (#639, #642)

1. Compose the existing public static handler with the existing registered-key read-only review handler. Accept only caller-owned public JavaScript; do not build or alter the frontend entry, acquire credentials, create a session, activate a listener, or change runtime or schemas.
2. Preserve static CSP/no-store/framing rules and private exact routes, fresh SSO/IAM, mandatory durable audit, and fail-closed errors. No SPA fallback or token-write routes.
3. Prove missing composition RED, then exercise public static and private signed SQL-backed list/detail/usage/CSV over the same loopback origin. Demonstrate fresh denial and audit failure; distinguish embedded SQL/structural DOM from installed PostgreSQL/native browser/IdP.
4. Run focused tests, full typecheck/lint/planning and required CI. Do not merge before exact-head formal independent approval or infer runtime/session activation approval.
