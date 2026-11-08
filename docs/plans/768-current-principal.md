# Current authenticated human principal

## Issue and problem

Issue: #768, parent #637 / #639. The management UI needs its current-principal context. Existing token-management HTTP only issues/revokes credentials and does not expose this read.

## Scope and expected behavior

1. Explicit server-facing `GET /management/v1/principal` returns only `{ id, kind: "human" }` after fresh registered-key RFC9068 verification and exact active-human binding resolution. This identifies the caller, not their administrative permissions.
2. Require an awaited nonsecret audit callback on success, authentication denial and unavailability. The caller must durably append before resolving; failure suppresses identity. Audit contains only server request ID, outcome and current principal ID or null.
3. Reject queries, GET bodies/framing, aborted requests and unsupported paths/methods. Ignore client identity headers and cookies. No supplied principal selection. Responses are no-store/nosniff with safe errors.
4. No automatic mount, session, login/logout, cookie, CORS, CSRF, BFF, token bridge, role/policy read, IAM bypass, SQL mutation, schema, provider call or deployment activation.

## Design

Add a small HTTP factory plus unbound Node server and a trusted PostgreSQL/RFC9068 composition. Capture ports at construction. Reuse the established human authenticator; never accept an authentication override in the production composition. Require explicit caller-owned durable audit rather than synthesizing proxy audit attribution or changing DDL. The listener/database/audit integration remains caller-owned. Existing session/IdP decisions remain unresolved.

Contract: [current principal](../../contracts/sso-current-principal-http.md). Original UI scope: #639 current-principal context. This is only its server-facing identity read, not browser session acceptance.

## TDD plan

First run a public-boundary test against the existing token-management HTTP: a valid signed JWT and migrated active-human binding get 404 instead of the required 200 identity projection. Then add the smallest dedicated handler. Test rejected JWT, deactivation and rebinding, service principals, unavailable binding, malformed authenticator result, required audit precedence and pending audit, safe response/audit projection, unknown paths, framing, abort, captured ports and actual Node loopback HTTP. Use PGlite for local database tests; do not call it installed PostgreSQL acceptance.

Run focused Node tests, typecheck, lint, planning checks, compatibility and standard npm run check. Record resource-limited failures separately from CI.

## Delivery

Open a draft PR with exact-head RED/GREEN evidence. Require all mandatory exact-head CI and valid formal independent approval before merge. Rollback removes the opt-in factory; no migration or active listener changes. Remaining risks: caller must supply a genuinely durable audit and approved ingress, session and lifecycle wiring; read freshness is per binding read, not transactionally atomic revocation.
