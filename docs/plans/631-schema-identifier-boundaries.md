# Exact Gemini identifier regression boundaries

## Issue and problem

Issue #631, refs #116 and investigation #630. A suspected JavaScript end-assertion defect was disproved: without the multiline flag, existing patterns already reject trailing line terminators. Do not change correct production validation. Preserve this existing contract with explicit public-boundary regression tests instead.

## Scope and expected behavior

Cover trailing LF, CR, CRLF, Unicode line separator and paragraph separator in root/definition/alias anchors, unused definition keys and local pointer/anchor references. Include a matching malformed key/reference to ensure lookup cannot hide a grammar defect. Public validator, both HTTP chat bases and direct native text-stream preparation must reject before credential access or transport. Preserve private error/audit behavior and immutable input. Existing exact64-character valid names remain accepted. No production behavior, new schema features, policy, pins, dependencies, storage or operational claims change.

## Design

Extend the existing response-format fixtures and use real public gateway/adapters. One independently named regression per terminator/position avoids a first failure hiding the rest. Validate controls separately so rejection is not caused by broken test setup. No new glossary term, design decision or ADR.

## TDD and verification

This is test-only coverage of already-correct behavior: no production-code change and no expected RED or fabricated fixed defect. Record baseline reproduction from #630 and run the added tests immediately. Run all response-format tests and complete repository tests under resource-aware native Node22, typecheck/lint, planning/link/contracts/fixture-secret checks, six offline pins and attempt npm run check. Distinguish direct component results from the standard command/environment failure and existing external PostgreSQL skip. Local Docker/bridge/systemd/live providers remain uncertified.

## Delivery

Issue and plan precede tests. Existing contracts are unchanged; link this reinforcement from acceptance and handoff only. Commit as sjungwon03 with DCO and Assisted-by. Require exact-head formal GitHub approval and all required CI before normal guarded squash. Do not touch #561 or other worktrees. Rollback removes only regression coverage; full #116/#7 stay open.

## Verification evidence

Native Node22.23.4: all46 newly added cases passed immediately on unchanged production code, confirming this is test-only reinforcement, not a fixed defect or TDD RED. Complete response-format suite381 passed,0 failed/skipped. Direct complete repository tests passed exit0:8,912 passed,0 failed,1 existing optional external PostgreSQL skip (8,913 total). Full typecheck exit0; lint exit0 with42 warnings/137 infos, including nonblocking style suggestions. Planning/link/contracts/fixture-secret, six offline pins and diff checks passed.

The standard npm run check also ran completely and PASSED exit0 with8,912 passed/0 failed/1 existing skip and all downstream planning/pin checks. The native npm launcher is now executable and functional in the current environment; this work did not repair or modify shared tooling and does not retroactively convert earlier launcher failures into passes. Logs /tmp/opengranter-631-{focused,formats,alltests,typecheck,lint,docs,pins,check}.log; explicit alltests/typecheck/check exit files contain0. Local Docker/bridge/systemd/live providers remain unverified. Exact-head formal approval and required CI are still mandatory before merge.
