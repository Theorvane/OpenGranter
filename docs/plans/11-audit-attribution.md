# Gateway Audit Attribution

## Issue and problem

- Issue: [#11](https://github.com/Theorvane/OpenGranter/issues/11)
- The gateway's authenticated principal now has a safe credential ID and versioned policy references, but request and managed-route audit events omit them. An auditor cannot reconstruct which identity and policy snapshot governed a call from those events.

## Scope and expected behavior

- In scope: make authenticated identity metadata mandatory at the HTTP gateway boundary, propagate it to all post-authentication audit events and the managed-route coordinator, and test that success, denial, and failure events carry the same identifiers without sensitive content.
- Out of scope: durable audit storage, tamper resistance, retention, content auditing, policy statement capture, or changing the unauthenticated audit shape.
- An authenticated request has a nonempty principal ID and credential ID and a list of policy IDs and versions. Missing or invalid attribution returns a safe authentication-unavailable response before route lookup. Authentication failures record only a request ID.
- Raw proxy tokens, policy statements, Jev credentials, provider keys, prompts, and responses must never enter ordinary audit event bodies.

## Design

- Extend the authenticated principal contract with required `credentialId` and `policyVersions`. The attachment authenticator already supplies both.
- Define one audit attribution type and add it to gateway post-auth events and managed-route events. Keep unauthenticated events separate.
- Pass the immutable attribution snapshot into the coordinator with the route version. Each denial, selection, decision, and attempt event receives the same fields.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [routing contract](../routing.md), [acceptance scenarios](../acceptance.md), and [engineering harness](../harness.md). No new domain term or ADR is needed.
- Persisting immutable events, hashing/chaining, access control, and content retention remain later infrastructure work.

## TDD plan

- First add HTTP-boundary tests asserting that a successful managed call's selection, decision, and attempt audit events include the authenticated principal/credential/policy versions and no raw token or statements. Confirm failure against the current events.
- Add denial and route-failure tests, plus missing attribution. Verify unauthenticated audit events remain anonymous.
- Update coordinator tests for required attribution and prove retry attempts use the same snapshot. Run focused red and green tests, `npm run check`, and `git diff --check`.

## Delivery

- Commit to `feat/11-audit-attribution` with the contributor's DCO and assistance trailers. Open a ready PR linked to this plan and #11.
- The current in-memory audit port remains a dependency. No claim of durable or tamper-resistant storage is made by this issue.
