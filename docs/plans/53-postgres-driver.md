# PostgreSQL driver connection

## Issue and problem

- Issue: #53
- Query and migration ports currently require caller-provided connections. A deployment needs a real PostgreSQL driver with explicit ownership and safe failures.

## Scope and expected behavior

- Add a node-postgres pool adapter, dedicated transactions, and shutdown.
- Accept trusted driver configuration; never log credentials, SQL, or driver errors.
- Preserve application callback errors after successful rollback. Driver failures become fixed availability errors. Never retry ambiguous commits.
- Exclude deployment startup, migration concurrency coordination, and management APIs. IAM, usage, and audit semantics remain unchanged.

## Design

- Adapt a narrow pool port and expose a factory backed by pg.Pool.
- Query through the pool; run BEGIN/callback/COMMIT on one checked-out client. Roll back failures and destroy connections after uncertain commit or failed rollback. Invalidate transaction handles before release.
- Handle idle pool errors through an optional nonsecret notification. Shutdown is idempotent and rejects new operations.
- A dedicated connection is required because pool queries cannot guarantee transaction affinity.
- Update architecture and acceptance. Deployment secret delivery and pool sizing remain operator choices.

## TDD plan

- First test imports the absent adapter: expected module-not-found red.
- Verify dedicated connection affinity, success/release, rollback, acquisition/query/commit failures, discarded broken connections, escaped handles, safe idle errors, checked-out client errors, caught query failures, and shutdown.
- Run all migrations twice against an isolated real PostgreSQL test database; verify transactional rollback and parameter binding.
- Implement the smallest port adapter and pg factory, then run npm run check.

## Delivery

- Write tests, record red, add dependency and implementation, document integration setup.
- Capture real PostgreSQL evidence and full checks in the PR.
- Database configuration is trusted. Concurrent migrators and in-flight shutdown coordination remain deployment responsibilities; close drains checked-out operations.
