# Isolate exact usage request tracing on the current runtime

1. Reuse #760 exact, case-sensitive 1–256 ASCII request-ID contract; isolate backend changes from its old frontend/session stack. Depend on #855/#859.
2. RED: owned Node HTTP + signed test JWT + migrated PGlite must serve filtered JSON/CSV with stable continuation, empty results and foreign-principal denial. Original parser must reject valid tracing.
3. GREEN: propagate validated request_id through SSO and proxy reads into parameterized SQL; intersect existing filters and validate hidden rows. No schema, IAM, session, history opt-in or default-dispatch changes.
4. Run runtime/parser/reader regressions, typecheck/lint and planning checks. Embedded SQL is not installed PostgreSQL or browser-login acceptance.
5. Publish an isolated backend PR. #760 retains its UI stack. Require exact-head CI and independent formal approval. No deployment or paid calls.

6. Preserve the #838 owned SQL query snapshot while isolating the filter, including requestId and nested cursor across the database await. Reuse its production fix and regression tests rather than duplicate functionality.
