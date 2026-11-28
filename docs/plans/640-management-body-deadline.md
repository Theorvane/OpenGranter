# Bound token management request reads

## 1. Requirement and scope

Issue #640, parent #637. Existing SSO issuance/revocation validates streamed bytes but can wait forever for an authenticated producer below the size limit. Bound the entire body read to 15 seconds, not a per-chunk idle timeout. Preserve fresh authentication, current IAM, required audit and explicit mutation confirmation. No session acquisition, policy, schema, public-entry or deployment activation.

## 2. Contract and design

Start one monotonic deadline only after authentication and existing route/query/media checks, before the first body read. Race every pending read against deadline/abort; cancel and release best-effort without waiting for producer cleanup. Reject late EOF/chunks even when timer delivery is delayed. Return existing generic 400 invalid_request/no-store/server request ID and dispatch no mutation. The deadline ends before service dispatch; it does not cancel a dispatched mutation or certify rollback, and does not bound authentication/database work. No retries. Timeout is a resource bound, not an identity lifetime.

## 3. Acceptance and RED/GREEN

Both operations: stalled first read and incomplete trickle expire, stalled/rejecting cleanup cannot delay response, abort rejects promptly, late completion cannot dispatch, normal completion clears timer, and dispatched mutation is not timed out. Use deterministic timers for read boundary and real socket adapter success regression. Regress existing auth ordering, validation, mandatory audit and cancellation. Run focused tests, TypeScript, Biome and planning checks; distinguish synthetic ports from installed SSO/PostgreSQL/provider evidence.

## 4. Delivery and rollback

Plan and contract first, failing executable cases, minimal runtime, regression/checks, commit/PR and exact-head review/CI. Rollback by reverting this slice only. No credentials, live provider calls or deployment. Browser login and approved BFF/session contract remain separate unresolved gates.

References: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [HTTP contract](../../contracts/sso-management-http.md).
