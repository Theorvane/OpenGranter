# IAM-Scoped Audit History API

## Issue and problem

- Issue: [#41](https://github.com/Theorvane/OpenGranter/issues/41)
- The PostgreSQL audit history reader is internal. An auditor with an explicit policy grant has no HTTP boundary for inspecting a principal's metadata events.

## Scope and expected behavior

- In scope: authenticated `GET /v1/audit`, one principal per request, `principal_id`, `limit` (default 50, maximum 100), and descending event-ID `cursor`. An omitted `principal_id` selects the caller; either form requires `audit:Read` on `principal:<target-id>`. Neither self access nor administrator status grants an implicit permission.
- Return `object: "list"`, allowlisted `data`, `has_more`, and `next_cursor`. Invalid queries return 400; denied access returns 403 before storage; unavailable storage returns a safe 503. Required read-audit failure returns 503.
- Out of scope: anonymous and organization-wide search, content-audit body retrieval, retention, export, and deployment connection wiring.
- Successful, denied, and unavailable reads get attributed metadata events. The response never includes prompts, responses, tokens, keys, or unexpected storage fields.

## Design

- Reuse the existing authenticated gateway, IAM evaluator, and principal-filtered PostgreSQL reader. Keep the storage reader injected as a port.
- Validate query syntax and the returned page at the HTTP boundary, then copy only known fields. Validate event order, principal scope, pagination cursor, and projected details so an untrusted adapter cannot expand the response.
- Use `principal:<id>` to make `audit:Read` grants precise and consistent with existing usage-resource semantics. This defines only the principal-scoped API slice; broader search resources remain open.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance scenarios](../acceptance.md), and [gateway contract cases](../../contracts/gateway_cases.json). No ADR: this is a narrow extension of the existing IAM and storage design.
- Open decisions: anonymous/organization-wide reads, content access policy, retention, and export.

## TDD plan

- First add an HTTP-boundary test for an explicitly granted reader, a principal-scoped storage query, and sanitized result; observe a 404 red result.
- Add default and explicit Deny, cross-principal grant, malformed query/cursor, malformed page, storage failure, audit-write failure, and pagination cases. Verify the persistent audit projector recognizes only the new event metadata.
- Implement the smallest query/parser, gateway branch, and audit projector changes. Run focused tests, then `npm run check`.

## Delivery

- Implement on `feat/41-audit-history-api`, commit with the authorized DCO and assistance trailers, and open a ready PR linked to the issue and this plan.
- Rollback is removal of the optional read port and endpoint; stored audit events remain intact. The largest risk is exposing malformed adapter data, so the boundary projects and validates before returning.
