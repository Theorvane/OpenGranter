# Durable owned-routing reservations

## Independent review corrections

The separate reviewer reproduced two gaps at 5e34082: time was captured before a contended principal lock, and missing post-crash handoff prevented authoritative settlement forever. Add failing public-boundary tests before corrections. Refresh the clock after acquiring the serialization lock for every time-sensitive transition. Persist the known attempt-intent timestamp; on a fenced recovered intent, authoritative settlement must first append a truthful unknown-outcome record to the existing usage ledger, with null latency, missing usage/costs and unknown actual provider. Extend existing usage validation/JSON/CSV/detail contracts to preserve those unknowns, without inventing outcome, latency, token counts or provider bills. Keep immutable conflict behavior for a later contradictory handoff. Required recovery-append/audit/settlement failure rolls back the entire transaction. Re-run full checks and request independent re-review of the follow-up head; the earlier passing gate does not validate these new changes.

Resolved at implementation 8f5aad2ffb5929c5c2a5b3d43756db65d435748f. Both public-boundary regressions failed for the reported reasons before correction; unknown-detail rendering also had an expected RED. Focused GREEN passed 32 cases, then active-execution denial, transactional recovery-audit rollback and strict rejection of fabricated unknown fields were included in the final full gate. Full npm run check PASSED in 129.5 seconds: 10,666 tests, 10,663 passed, zero failures/cancellations and the same three existing local skips, including a running installed PostgreSQL17 reservation test. Typecheck/lint/planning/links/secrets and all six unchanged schema pins passed on Node22.23.2 with canonical TMPDIR=/private/tmp. The evidence-only documentation delta does not alter production, tests, migrations or dependencies.

Independent reviewer dispatch ctx_745622d0a916 re-ran its unchanged two-connection installed PostgreSQL experiment at this exact implementation: expired admission denied, expired start rejected, fenced lost-handoff settlement accepted with debit0. It also independently ran five public-boundary follow-up cases (clock, recovered accounting, active-execution/audit rollback, strict unknown validation and details) with five passes and no new blocking finding. This is independent review evidence, not formal approval or deployment acceptance; final GitHub COMMENT/check state is tracked in the PR and Linear.

## Issue and problem

- Issue: [#1016](https://github.com/Theorvane/OpenGranter/issues/1016), THE-18.
- The opt-in core in unmerged PR #1007 requires real atomic admission and reconciliation. Existing immutable usage append does not reserve liability or close the crash-before-handoff gap.

## Scope and expected behavior

- Implement an opt-in PostgreSQL reservation service, using existing IAM, transaction connection, usage ledger and audit history. No gateway activation or copied unmerged core.
- Apply the six policies approved in [THE-18](https://linear.app/theorvane/issue/THE-18/implement-durable-owned-routing-quota-and-budget-reservations#comment-e89916dc): fixed UTC principal windows, explicit quota and currency, summed attested liability bounds, durable intent/fencing, atomic immutable usage handoff, retained uncertainty and no expiry write-off/replay.
- No production caps, pricing algorithms, configuration UI, invoice collection, Jev, live calls or deployment.

## Design

- Lock a durable principal policy row before every mutation. Store reservations and attempt control state beside, rather than duplicating, usage_records. Existing usage append executes on the same transaction as handoff/control audit.
- A trusted authenticated composition supplies candidate identity, route/request binding and administrator-attested liability bounds. The service independently evaluates model, transport and final-provider IAM before admission. Policy rows are explicitly provisioned by trusted deployment, absent by default.
- Admission replay returns observed state without execution authority. A fresh opaque owner token fences active operations. Persist start intent before adapter entry; duplicate start never grants permission. Complete/expiry revoke that authority, releasing only never-entered slots; started unknown slots retain full liability. Recovery never invokes inference.
- Authoritative reconciliation is an injected trusted evidence resolver, never provider content or HTTP amounts. It records evidence-linked settlement separately from immutable usage amounts; excess liability blocks later admissions and is never clamped. Estimates remain estimates.
- See [contract](../../contracts/durable-reservations.md). PR1007/1013/1015 remain independent unmerged integration prerequisites; the production gateway is unchanged.

## TDD plan

- First RED: public PostgreSQL admission race with one allowance fails because the reservation module does not exist.
- Cover IAM denials, complete candidate exposure, missing/stale policy and bounds, duplicate/conflicting identities, atomic handoff rollback, replay/conflict, restart, expiry/fencing, unknown cost, cross-window holds, reconciliation/overrun and mandatory audit failure.
- Use disk-backed PGlite for restart and separate real PostgreSQL connections when available. Run focused tests and npm run check; distinguish installed/multi-process operational acceptance from embedded tests.

## Delivery

- Plan and contract; RED tests; smallest implementation; GREEN and refactor; full checks; independent COMMENT review; exact-head CI.
- Rollback: do not compose the new service. No default runtime changes. A migration adds empty tables only; never delete unresolved reservations during rollback.
- Remaining operational prerequisites: trusted policy/bound provisioning and reconciliation authority, core/HTTP composition, real invoice evidence and deployment validation.
- Integration risk: unmerged PR #1013 independently adds migration 015_owned_configuration.sql. This branch starts independently from current main with 015_durable_reservations.sql; before combining those PRs, sequence and renumber the not-yet-applied latter migration and manifest/tests together. Never change an applied migration checksum. No merge is authorized here.
- Verification at implementation 5e34082ee73155ffe6554eb86efea0e87aad29b1: Node 22.23.2, canonical TMPDIR=/private/tmp and the isolated local PostgreSQL socket; full npm run check PASSED in 128.1 seconds, 10,661 tests / 10,658 passed / zero failed or canceled / three existing local skips (two macOS subprocess cases and the pre-existing opt-in PostgreSQL case). Typecheck, Biome, planning/links/fixture-secret scan and all six pinned OpenRouter schema gates passed. The new installed PostgreSQL test ran, rather than skipped.
- Focused evidence: 46 accounting/audit/migration/reservation cases passed before the later regressions. The final full run includes 19 new reservation cases, including two installed PostgreSQL pools competing across sixteen requests, disk reopen, unknown/duplicate usage, transactional audit/usage failures, expiry fencing, settlement/overrun, stale liability, existing-ledger identity protection, quota snapshot drift and malformed persisted binding.
- RED/GREEN: the first environment run lacked dependencies and is not functional RED evidence; after npm ci the module-absent failure was reproduced. Genuine incremental RED regressions then caught response-start fallback, omitted possible-duplicate enforcement, stale attestation admission, replay of an existing gateway request identity, missing policy snapshot, and persisted-binding redirection. Each failed for its expected behavior before the corresponding correction; all are GREEN in the aggregate gate.
- The earlier aggregate reported 10,649 passed / six failures / three skips. Five existing OAuth fixture failures were caused by the /tmp symlink; canonical TMPDIR independently passed 13 with two platform skips without auth-code changes. The sixth was an obsolete historical-migration assertion after the additive migration; it now locates migration014 explicitly. No earlier aggregate success is claimed.
- Independent COMMENT review and exact-head remote CI: pending at this evidence commit; do not infer approval or operational readiness. There is no installed multi-process HTTP gateway or live billing/provider acceptance. The overrun audit event is a durable monitoring signal; paging and authorized operational remediation require separate composition.
