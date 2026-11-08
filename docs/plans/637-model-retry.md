# Models read recovery (#637, #639, #641)

1. Preserve the failed list or detail operation in the existing SSO Models mount, not in storage or a new authority adapter.
2. Render an explicit Retry control on temporary unavailability only. Retry the same detail target, without silently falling back to a list or changing IAM. Keep Back to models as a separate escape.
3. Bind retries to the exact render and synchronous grant expiry. Missing, denied and unauthenticated results must not gain retry authority.
4. Establish RED/GREEN for source and compiled public modules, including failed-list recovery, detail recovery, duplicate/stale retry and expiry.
5. Traverse actual signed-test SSO/loopback HTTP/migrated PGlite with the production handler. Attempt isolated native headless Chromium without touching the managed desktop. Record it separately from company SSO, installed PostgreSQL and live provider acceptance.
6. Run types/lint/checks, publish a draft PR and request exact-head formal review. No merge without all required CI and approval. No session, schema, permissions, deployment or paid calls are authorized.
