# Filter Audit History by Exact Model Alias

## Issue and problem

- Issue: #75
- The PRD requires review by model, but audit history accepts principal/time pagination only. Complete this agreed review capability without changing authorization scope.

## Scope and expected behavior

Add optional `model` to GET /v1/audit for both JSON and CSV. It matches an exact projected `details.modelAlias`; no prefix/glob matching or model lookup occurs. Events without an alias are excluded when the filter is supplied; omitting it retains existing history. Match usage filter syntax: nonblank, at most 256 characters, no control characters; values are not trimmed or rewritten. Repeated/invalid query fields return 400 before storage.

Target-principal `audit:Read` still applies, even for self. Auditors need no inference permission to inspect an alias. Event-ID pagination, time bounds, maximum page size, content/secret projection, and required read auditing remain unchanged.

## Design

Add pure audit history filters extending existing time ranges. SQL binds a JSONB model-alias equality alongside principal/cursor/time predicates. Validate all SQL rows including lookahead after known-event projection; an unknown/spoofed field cannot certify a model match. HTTP reprojects injected pages with the same constraints and CSV reuses that validation. Clients repeat model/time/principal filters with every continuation cursor.

Do not add indexes without measurements. Model filtering excludes metadata such as model lists and audit reads that have no single model alias. No token-management decision history, organization-wide search, content-audit reader, or new IAM action is introduced. See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [HTTP cases](../../contracts/gateway_cases.json).

## TDD plan

First add HTTP model success and SQL scope/pagination cases and confirm failure because model is rejected/ignored. Cover model/time/cursor conjunction, JSON/CSV parity, absent alias exclusion, cross-principal denial, default/explicit Deny, malformed/duplicate filters before storage, required audit failure, out-of-model SQL/HTTP pages, and hostile-looking literal binding. Implement the smallest parser/reader/projection changes and run focused tests followed by `npm run check`.

## Delivery

Issue and branch, plan, red evidence, implementation, green evidence, document/contract updates, full gate, ready PR. The option is additive and requires no migration. Large filtered queries need deployment measurements before adding indexes. Existing JSON event shape and CSV columns remain unchanged.

## Verification

Completed with the evidence below.

- Red: direct `node --experimental-strip-types` runs of the HTTP and PostgreSQL audit-history tests failed as expected. HTTP model requests returned 400 instead of 200/403/503, SQL included the alias-less event, and invalid/out-of-model filters were ignored.
- Green: the same commands passed all 20 HTTP and 11 SQL tests after implementation. The preexisting SQL binding assertion was updated for the sixth, optional model parameter; all original validation checks remain.
- Final `npm run check` passed TypeScript, Biome, 294 tests, and planning/link/contract/fixture validation. One real PostgreSQL integration test skipped locally without its explicit database URL; CI provisions PostgreSQL.
- `git diff --check` passed. No schema change or index was added; deployment should benchmark large model-filtered histories before choosing an index. Content and token-management decision history remain separate.
