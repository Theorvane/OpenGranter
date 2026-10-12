# Own the PostgreSQL SSO management runtime

## Issue and problem

- Issue: [#494](https://github.com/Theorvane/OpenGranter/issues/494).
- Configured SSO management Fetch and unbound Node factories exist, but an operator cannot start them with the migrated, owned PostgreSQL lifecycle used by inference gateways.

## Scope and expected behavior

- Add an explicit opt-in `startPostgresSsoManagementGateway` on a configured host and port. It applies bundled migrations, owns one database connection and one management Node server, and returns the existing address/close contract.
- Compose the current configured RFC 9068 management server with the owned connection. The new runtime does not mount management routes on existing inference gateways or change their startup behavior.
- Preserve SSO authentication before body access, current binding/IAM, mandatory decision and anonymous authentication audit, atomic credential events, fixed no-store responses and secret privacy.
- No new database schema, provider route, proxy chat/discovery, usage or OpenRouter source pin changes.

## Design

- Reuse the private `startOwnedPostgresGateway` migration, bind, close and safe startup failure boundary. The public management runtime supplies only the existing configured management server factory.
- Configuration validation remains in the RFC 9068 factory. A failure after connection opening triggers the shared cleanup and exposes only `GatewayStartupUnavailable`.
- The server is separate and opt-in so trusted deployment code chooses its bind address and exposure. No implicit public bind or API route is added to inference runtimes.
- See [contract](../../contracts/sso-management-runtime.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [PRD](../PRD.md), and [compatibility](../openrouter-compatibility.md). This is a reversible runtime composition, so no ADR is needed.

## TDD plan

- First add a real-socket test importing the new runtime; observe the expected missing export, then cover a signed SSO token issuing and revoking a proxy credential against migrated PGlite.
- Cover anonymous rejected authentication audit, invalid configuration and migration/bind failure cleanup, no-store safe errors, shared idempotent close and unchanged inference runtimes.
- Implement the smallest wrapper around the existing owned lifecycle, then run focused tests and `npm run check`.

## Delivery

- Record red/green and full-check evidence in the PR. Use the authorized contributor/DCO identity and request review through repository automation.
- Risk: this factory alone does not provision issuer bindings or configure an operator's network ingress. A lost issuance response can still leave a valid unseen token; the existing no-retry contract applies.

## Verification evidence

- Red: the new public-boundary test failed because `startPostgresSsoManagementGateway` was not exported.
- Green: five focused real-socket/PGlite cases passed for SSO issue/revoke, fresh IAM Deny, anonymous authentication audit, active-request shutdown and safe configuration/migration/bind cleanup.
- `NODE_NO_WARNINGS=1 npm run check` passed: 6,617 tests passed, one optional external PostgreSQL test skipped, and type, lint, planning and three pinned OpenRouter schema checks passed. The host's Node 22.14.0 emits an experimental type-stripping warning on stderr; without that environment setting, 17 existing CLI tests that require empty stderr fail, and all 17 pass with the warning suppressed.
