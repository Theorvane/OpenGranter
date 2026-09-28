# Persisted direct gateway composition

## Issue and problem

- Issue: #59
- A persisted provider reader and HTTP gateway exist, but deployment code still has to manually load registrations and wire the direct invoker.

## Scope and expected behavior

- Add asynchronous handler and unbound Node server factories that load enabled registrations once and construct the existing direct adapter.
- Keep authentication, IAM, limits, usage/audit, optional delegated/Jev ports, and fixed provider hosts on the existing path.
- The caller supplies connection, clock, request IDs, secret resolution, limits, and optional fake/real transport configuration. No migration, listening, environment reads, or secret retrieval at construction.
- Safe configuration-load errors reject construction before a server exists. Empty registrations remain valid for delegated-only or unpublished installations.
- No live reload, management API, process startup, or new authorization semantics.

## Design

- createPostgresDirectChatHandler combines the reader, direct invoker, and existing PostgreSQL handler.
- createNodePostgresDirectChatServer exposes that composed handler through the shared request bridge.
- Retain both existing factories for callers providing custom invocation ports.
- Snapshot semantics match the persisted provider contract: callers rebuild after registration changes.
- Update PRD, architecture, and acceptance. Existing HTTP contract cases remain applicable.

## TDD plan

- Add a socket integration test importing the absent async server factory; expect module export failure before implementation.
- Apply all migrations, seed IAM/catalog/provider configuration, issue a token, and invoke a persisted registration through a fake provider transport.
- Verify persisted content-free usage/audit, explicit Deny and revocation before any extra secret/transport call, and safe construction failure on unavailable/malformed registration storage.
- Keep optional delegated/Jev ports forwarded. Run npm run check.

## Delivery

- Report red/green commands and remaining startup/reload responsibilities in the PR.
- Production provider accounts and secret managers remain outside this test fixture. No live provider calls.
