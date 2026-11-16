# Published model list discovery (#641)

## Issue and problem

1. Parent #637, delivery #641. The actual authorized catalog list already contains published names/descriptions, but the UI hides both and searches only aliases/publishers. Users cannot discover an administrator-described model without opening every alias.

## Scope and expected behavior

2. Render optional names/descriptions beside exact alias buttons. Search alias, publisher, name and description by case-insensitive literal substring, preserving server order. Legacy records stay navigable. No endpoint, session, IdP, CSRF, IAM, schema, provider or deployment change.
3. Keep text-only insertion, fresh authorization for detail reads and mandatory audit. Searching adds neither requests nor authority. Empty/no-match/loading/denial/disposal cannot retain old rows; no cross-render search persistence.

## Design

4. Extend the existing list view rather than duplicate catalog transport or add navigation. No regex or remote filter protocol. Admin login/session approval remains a separate unresolved dependency. See [contract](../../contracts/model-list-publication.md), [PRD](../PRD.md), [architecture](../architecture.md) and [acceptance](../acceptance.md).

## TDD plan

5. Add public DOM tests before production: published metadata, literal search including Korean and punctuation, no network, server order, legacy records, exact alias and state cleanup. RED: 2 failures, 1 pass; GREEN: 54 focused DOM/app/navigation tests pass, zero skip.
6. Extend the actual Node HTTP, signed synthetic JWT, fresh IAM, migrated embedded PostgreSQL and durable-audit integration test to search returned list metadata and select detail. Its isolated case passes. Full HTTP file attempt was SIGKILL after 4 passes; it is NOT a passing whole-file result. Separate browser verification is local synthetic authentication, not admin login or installed acceptance.

## Delivery

7. Run bounded regressions, full TypeScript, changed-file lint and planning/fixture checks. Record exact commands/logs in PR. Submit exact-head CI and independent formal review; no merge without both, including stack dependencies.
8. Rollback is removal of list-only presentation/filter changes. No persisted data or active session contract changes. Deployment/provider tests and original PRD completion remain open.
