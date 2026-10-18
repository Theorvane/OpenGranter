# Prevent caching of private model discovery

## Issue and problem

- Issue: [#518](https://github.com/Theorvane/OpenGranter/issues/518), part of #116.
- Model discovery varies with authenticated principal, current model/final-provider IAM and administrator catalog. Listing success and listing/count errors currently omit no-store; the generic Node pre-header fallback also omits it for discovery.

## Scope and expected behavior

- Emit Cache-Control: no-store for recognized /v1/models, /api/v1/models, /api/v1/models/count and /api/v1/model/* paths, including unsupported methods, invalid queries/aliases, authentication, catalog and required-audit errors.
- Preserve current bodies/status/request IDs and enabled-model/provider IAM with explicit Deny precedence. All existing audit gates and content-free records remain mandatory; no inference, limits, secrets or usage operations are added.
- Include Node pre-header fallback, including a caller-supplied fallback response. Preserve unrelated endpoint cache behavior and do not add ETag, 304 handling or caching infrastructure.

## Design

- Use one small discovery-path predicate shared by the Fetch gateway error decorator and Node fallback. List success adds the directive alongside its existing request ID. Count/single success already use it.
- The Node bridge sets no-store before forwarding recognized discovery responses and fallback headers, ensuring the transport boundary also protects custom handlers. Leave unrelated responses untouched. No upstream headers, caller text or response content are logged or added to audit.
- Prefer the standard no-store directive to cache validators or user-specific cache keys because each request must reevaluate authorization and required audit. This does not purge earlier caches, control client-internal state or guarantee that external proxies obey headers.
- Update [contract](../../contracts/model-discovery-cache.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md) and [compatibility](../openrouter-compatibility.md). No schema pin, migration, glossary or ADR change is required.
- No open product decision in this bounded privacy correction; broader compatibility #116 and unresolved Jev #7 remain open.

## TDD plan

- First reproduce missing no-store through public Fetch requests and actual Node sockets; record the expected assertion failures before production edits.
- Cover managed/delegated listing, legacy/compatible paths, paging/filtering and fresh policy/catalog reads; implicit/explicit Deny, empty lists, malformed queries, missing/inactive/failing authentication, broken catalogs and required-audit failures.
- Cover count and single-model success/errors, unrecognized neighboring paths, unsupported methods, normal/custom Node responses, thrown-handler generic/custom fallbacks, and installed OpenRouter/OpenAI SDK consumption.
- Keep response/body attribution and audit privacy assertions. Run focused discovery/socket/error regressions, strict types/lint and npm run check.

## Delivery

- Commit on the issue branch with authorized identity, Assisted-by and DCO; open a ready plan-linked PR. Merge requires current-head approval and successful checks.
- Rollback reverts the predicate/header change as a unit. Primary limitation: header compliance is external and already stored copies are not invalidated.
- Record red/green evidence, full validation and limitations below and in the PR.

## Verification evidence

- Red: the new Fetch/Node/installed-SDK regression suite ran 23 cases before production changes: 19 expected failures for missing/conflicting no-store and four existing passes. OpenRouter wraps a response-hook assertion in its client error; Fetch/socket failures show the header mismatch directly. Evidence: /tmp/opengranter-518-red.log.
- Green: all 23 cases passed; nine focused cache/error/discovery/SDK suites passed all 94 cases. Evidence: /tmp/opengranter-518-green.log and /tmp/opengranter-518-focused.log. Strict TypeScript and Biome passed without configuration changes.
- Full `env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 6,917 cases, 6,916 passed, one optional external PostgreSQL skip, zero failures/cancellations. Planning/link/contract/fixture-secret scans and all existing four offline schema integrity checks passed. Evidence: /tmp/opengranter-518-check.log.
- Existing source pin bytes and migrations have no changes. No live model calls or new SDK/schema compatibility claims were introduced. PR #517 was subsequently approved on its exact head with all checks successful and merged as 4f3d7df. This branch was rebased onto that main; the sole PRD insertion conflict was resolved by retaining both sections. The integrated five-pin gate is rerun below before updating the PR head.
- Integrated default-concurrency run: 6,960 cases, 6,956 passed, one optional skip, zero assertion failures and three cancellations at existing 15-second PostgreSQL shutdown test deadlines. Both unchanged runtime files then passed all 24 cases in isolation (127.4 seconds). Evidence: /tmp/opengranter-518-integrated-check.log and /tmp/opengranter-518-runtime-recheck.log. No tests, timeouts, warning handling or production lifecycle code were changed. The full integrated npm gate is retried with process CPU affinity 0-3 to bound the Node test runner's available parallelism under host contention.
- Integrated retry passed with `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check`: all 6,960 cases completed, 6,959 passed, one optional external PostgreSQL skip, zero failures/cancellations. Strict types, lint, planning/link/contract/fixture-secret checks and all five offline schema integrity checks passed. Evidence: /tmp/opengranter-518-integrated-retry.log. CPU affinity bounded scheduling only; every original test and deadline remained enabled.
