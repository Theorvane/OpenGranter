# Safe typed client errors

## Issue and problem

- Issue: [#132](https://github.com/Theorvane/OpenGranter/issues/132), compatibility parent #116.
- Numeric /api/v1 errors lack the documented metadata.error_type used by clients for machine-readable classification.

## Scope and expected behavior

- Add fixed allowlisted error_type to /api/v1 metadata alongside opengranter_code. Retain statuses, fixed messages and request identifiers; legacy /v1 remains unchanged.
- Known local validation/authentication/permission/limit/not-found causes map to documented vocabulary. Local dependency/internal failures map to server. Undifferentiated upstream_failed maps to unmapped; never invent a more specific provider cause.
- Node pre-header fallback receives server through the shared serializer. No exception/provider body, content or secret enters responses.
- Out of scope: upstream cause propagation, retries/Retry-After, streaming, error status changes, endpoint expansion or changes to IAM/audit/usage.

## Design

- A complete compile-time checked mapping keyed by ClientErrorCode sits beside the fixed message table. All values are approved strings, with no arbitrary metadata input.
- Keeping unmapped for collapsed provider failures preserves uncertainty; inferring rate-limit/timeout from generic failures would mislead clients. Internal secret-store failures are server errors, not client authentication failures.
- Update [contract](../../contracts/openrouter-error-schema.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [compatibility](../openrouter-compatibility.md).
- Full provider typed error coverage and streaming remain explicit compatibility gaps; no new costly architectural decision is made.

## TDD plan

- Extend public HTTP error cases with explicit vocabulary expectations; verify legacy parity, safe messages/request IDs and audit non-disclosure.
- Cover Node fallback and pathname/query eligibility. Exercise the public serializer for every local reason including unavailable history reasons whose compatible paths are not enabled.
- Confirm red for absent error_type, implement the minimal allowlisted serializer addition, run focused Biome and full npm run check.

## Delivery

- Additive metadata, no migration or live upstream calls. Reverting removes only typed metadata on compatible paths.
- Record red/green, full checks and remaining provider-cause limitations in the pull request.

## Verification evidence

- Red: 15 failures and three passes in the 18-case public HTTP/server/serializer suite against the previous implementation, due to absent typed metadata.
- Green: all 18 cases and all 10 client-path conformance cases pass.
- Full npm run check passed: strict TypeScript, lint, 612 passing tests, one optional external PostgreSQL test skipped, and planning/link/contract/fixture checks.
- Focused Biome with --error-on-warnings passed without warnings; diff checks passed and the CLAUDE.md symbolic link remains intact.
- No migrations, live provider requests or real credentials. Precise upstream type propagation, retry hints and streaming remain open.
