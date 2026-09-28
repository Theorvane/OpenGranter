# Preserve direct-provider usage availability

## Issue and problem

- Issue: [#93](https://github.com/Theorvane/OpenGranter/issues/93).
- Direct normalization discards partial token counts and replaces invalid totals, making the existing ledger availability labels inaccurate.

## Scope and expected behavior

- Preserve supplied valid recognized counters, including zero and total-only reporting. Omit absent fields; sanitize invalid supplied counters to null. Continue deriving an absent total when both component counts are valid, with an invalid marker for unsafe sums.
- The ledger retains its existing reported/partial/missing/invalid classification. Inference completion success is independent of usage validity. No raw malformed data is retained.
- No changes to billing, pricing, quota enforcement, authentication, fallback, schema, container-level usage validation, or OpenRouter normalization.

## Design

- Extend normalized direct completion usage fields to optional number-or-null values. Project only the three standard counters; null is a safe invalid marker understood by the existing ledger.
- A missing total is derived only from two valid components. A supplied invalid total stays invalid rather than being replaced. Unsafe addition cannot manufacture a usable total.
- Dropping partial values loses reported facts; exposing raw invalid fields risks content disclosure. Explicit sanitized markers preserve availability without carrying arbitrary values.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [contract](../../contracts/direct-usage-availability.md). Remaining pricing and limits decisions stay open.

## TDD plan

- Run real direct invokers through `createChatHandler` with fake HTTP providers. Assert normalized response and captured ledger record through public boundaries.
- Test each provider family with complete, missing, prompt-only, completion-only, total-only, invalid component, invalid total, and overflowing derived total scenarios.
- Implement the shared normalization change, format, run focused suites and `npm run check`.

## Delivery

- Issue/plan precede implementation; report actual red/green and validation evidence in the ready PR.
- Consumers must accept absent/null usage counters when a provider incompletely or incorrectly reports them. Valid complete usage remains unchanged. No migration; rollback would restore lossy normalization.

## Verification evidence

- Red: 16 failures and 6 passing baseline complete/missing cases in the 22-case adapter-to-gateway suite on the prior implementation.
- Green: all 22 cases passed after projection changed; all 7 existing direct-provider tests also passed, including failure paths.
- `npm run check` passed strict TypeScript, Biome, 366 tests, and planning/link/contract/fixture checks. One external PostgreSQL driver case was skipped locally without a database URL; CI supplies PostgreSQL. Embedded database tests passed.
- `git diff --check` passed; `CLAUDE.md` remains a symlink to `AGENTS.md`; no schema changes or live provider calls.
