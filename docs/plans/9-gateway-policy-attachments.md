# Gateway Policy Attachment Integration

## Issue and problem

- Issue: [#9](https://github.com/Theorvane/OpenGranter/issues/9)
- The text-chat gateway currently accepts already flattened statements from its authentication port. The principal and role attachment evaluator is not connected, so an infrastructure adapter could accidentally omit inherited Deny rules or accept an incomplete snapshot.
- Human and service principals both need their current attachment snapshot evaluated for each request before the route or provider is contacted.

## Scope and expected behavior

- In scope: a reusable attachment resolver, a gateway authentication adapter that resolves a credential to a trusted principal/role/policy snapshot, and HTTP-boundary tests for Allow, Deny, inactive/revoked identities, unresolved attachments, mismatch, and infrastructure failure.
- Out of scope: proxy-token issuance or format, SSO, persistence engine selection, database migrations, policy administration, and a deployable identity store.
- The credential lookup supplies a credential ID, principal ID, and active state. The snapshot loader supplies a versioned principal, roles, and policies. The adapter returns the flattened statements and policy versions only if every attachment resolves uniquely and the principal IDs match. A revoked credential, inactive principal, or unresolved attachment is denied before any route lookup or external call. A failing loader produces a safe authentication-unavailable response.
- The raw token and policy statements never enter ordinary audit event bodies or error messages. The resolved credential ID and policy versions remain available to later audit integration.

## Design

- Extract one pure attachment-resolution function from `evaluateAttachments` so the evaluator and gateway adapter use the same completeness and deduplication rules.
- Keep credential verification and snapshot loading behind narrow ports. The adapter does not define token syntax or storage technology.
- Reuse the existing `createChatHandler` authentication port: it receives an `AuthenticatedPrincipal` whose statements are complete and current for the request. The existing model/provider evaluator still decides each candidate.
- A missing or duplicate role or policy denies the request rather than applying a partial Allow. A principal ID mismatch is treated as an unavailable/inconsistent identity snapshot and fails closed.
- Update [architecture](../architecture.md), [PRD](../PRD.md), [acceptance scenarios](../acceptance.md), and [engineering harness](../harness.md). The domain vocabulary is unchanged, so no glossary or ADR change is needed.

## TDD plan

- First add an HTTP-boundary regression: a service principal receives an Allow through a role, while a directly attached Deny overrides it. Confirm the test fails before the adapter exists.
- Cover a human principal with a direct Allow, revoked credential, inactive principal, missing/duplicate role or policy, mismatched principal ID, and loader failure. Assert that denied paths do not resolve routes, call Jev, or invoke a provider, and that audit/errors contain no token or statements.
- Refactor attachment resolution while preserving the existing contract tests. Run the focused test red, then green, `npm run check`, and `git diff --check`.

## Delivery

- Commit on `feat/9-gateway-policy-attachments` with the contributor's DCO and assistance trailers, then open a PR linked to #9 and this plan.
- The adapter assumes its credential and snapshot ports return trusted, internally validated records. A future persistence adapter must validate database data, enforce revocation on each lookup, and provide an appropriate consistency boundary. This PR does not claim a production token store.
