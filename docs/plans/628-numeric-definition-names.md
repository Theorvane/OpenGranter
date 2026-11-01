# Numeric-leading Gemini definition names

## Issue and problem

Issue #628, refs #116. The bounded structured-output transport still rejects root-$defs object member names beginning with an ASCII digit, though RFC6901 section4 resolves object member tokens literally (including leading zeros), not as array indices. Complete only this existing schema-transport limitation.

## Scope and expected behavior

Allow an initial ASCII digit in root-$defs names and their single local pointer token. Retain decoded1..64 characters, existing remaining character grammar, encoded token bound, exact one-pass ~1/~0 decoding, canonical pointer/anchor cycles, all unused definitions and depth16/shared20,000 visits/128-definition budgets. Named anchors still start with a letter/underscore. No URI decoding, integer normalization, fetching, nested definitions, arbitrary paths, generated-output validation, new policy or operational certification. Existing strict/tool/Anthropic rejection, immutable transport, IAM/limits/usage/audit/privacy stay unchanged.

## Design

Widen only the two definition-key/pointer initial-character classes in the shared Google schema validator. Preserve own-property lookup: 0 and 00 are distinct literal keys, including in alias chains. No glossary or ADR change: no new domain term, irreversible decision or unresolved product policy. Sources: https://www.rfc-editor.org/rfc/rfc6901#section-4 and the existing Google GenerationConfig $defs/$ref transport https://ai.google.dev/api/generate-content#GenerationConfig. Other local character restrictions remain intentional; this is not full JSON Schema compatibility.

## TDD plan

Before source, add numeric direct/escaped-alias modes to the existing both-base HTTP/actual-SDK/native-stream/security matrix. Add public-validator and HTTP/native-stream malformed, unused-definition, literal leading-zero, exact-length, canonical-cycle, depth/visit/count cases. Record expected missing-transport RED, then minimum change GREEN. Run the full response-format suite, typecheck, lint, planning/link/contracts/fixture-secret checks, six pins and npm run check. Report full-gate failures honestly.

## Delivery

Plan precedes source. Update PRD, architecture, acceptance, compatibility, contract and handoff. Commit as sjungwon03 with DCO and Assisted-by. Require exact-head formal approval plus all required CI for normal guarded squash merge. Do not touch #561 or other worktrees. Rollback reverts only numeric-leading name acceptance. Local Docker/bridge/systemd/live-provider certification and overall #116/#7 remain open.


## Verification evidence

Native Node22.23.4: new numeric-name matrix and boundary case RED17 failed,0 passed before source; minimum two character-class changes GREEN17 passed. Complete response-format suite335 passed,0 failed/skipped. Replaced only the newly valid old initial-digit rejection fixture with a still-invalid initial hyphen.

Full repository direct native test run PASSED exit0 with --test-concurrency=1 and GOMAXPROCS=2:8,866 passed,0 failed,1 existing skip (8,867 total, ~243s). This supersedes no historical result: #626 local all-tests attempt timed out exit124; it was not a pass. Full typecheck PASSED exit0, lint PASSED42 warnings/129 infos, planning/link/contracts/fixture-secret checks PASSED, all six offline pins PASSED, git diff --check PASSED. Standard npm run check could not start (exit126, pre-existing empty/nonexecutable native npm launcher); separate passing component checks do not mean npm itself is repaired. Shared tools untouched. Logs /tmp/opengranter-628-{red,green,formats-green,typecheck,lint,docs,pins,check,alltests}.log. Local Docker/bridge/systemd/live providers are not certified.

Exact-head formal GitHub approval and every required CI remain mandatory before merge. Overall #116 and unresolved #7 remain open.
