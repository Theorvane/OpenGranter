# Bounded escaped Gemini definition pointers

## Issue and problem

Issue #626, refs #116. The existing local-reference contract explicitly excludes escaped names, so schemas using JSON Pointer slash/tilde escaping fail before credentials. Complete this bounded part of the agreed structured-output transport requirement without expanding routing or product policy.

## Scope and expected behavior

Allow ASCII slash and tilde after the initial letter/underscore in root-only definition keys, retaining decoded length1..64 and128 definitions. Accept exact RFC6901 ~1 and ~0 escapes in the single root-$defs pointer token. Decode once, without URI decoding or normalization. Literal a~1b and a/b remain distinct names. Preserve immutable outgoing schemas, canonical definition identity across named anchors/pointers, all unused-definition validation, depth16 and shared20,000 visits. Strict/tool/Anthropic, remote references, extra path segments, malformed escapes and nested definitions remain pre-secret failures. No generated-output validation, live-provider or operational certification; #116/#7 remain open.

## Design

Change only the Gemini response-schema validator: widen definition-key grammar, bound encoded reference shape, decode the pointer token once for own-property resolution and existing canonical cycle checks. Do not rewrite captured schemas or fetch URLs. Alternatives: arbitrary pointer traversal/URI decoding would enlarge scope and are rejected. No new domain decisions, ADR or glossary terms.

Sources: https://ai.google.dev/api/generate-content#GenerationConfig lists $defs/$ref/$anchor support for the existing deprecated responseJsonSchema transport; https://www.rfc-editor.org/rfc/rfc6901#section-4 defines one-pass ~1/~0 evaluation. No transport migration or source-pin change. Review docs/PRD.md, docs/architecture.md, docs/acceptance.md, docs/openrouter-compatibility.md and contracts/client-response-formats.md.

## TDD plan

Before source, extend the existing fixture matrix with escaped pointer/anchor-alias cases across both HTTP bases, actual OpenAI SDK sockets, immutable native streams, IAM/limits/audit/usage/privacy and strict/tool/Anthropic rejection. Add unit edge cases for one-pass resolution, exact length, dangling/malformed escapes, raw paths, mixed cycles and resource bounds. Record expected missing-transport red, then minimum parser change green. Replace only newly valid old key-rejection fixtures, preserving invalid reference fixtures. Run full focused formats, lint, docs, six offline pins and npm run check; report local failures honestly, never substitute focused tests for full CI.

## Delivery

Issue and plan precede source. Exact-head read-only review plus formal GitHub approval and every required CI must succeed before normal guarded squash merge. Rollback reverts only escaped-name acceptance. Do not touch #561 or other worktrees; retain unverified local Docker/bridge/systemd/live status.


## Verification evidence

Native Node22.23.4 new escaped-key HTTP/SDK/native-stream matrix plus boundary case: RED17 failed,0 passed before source, because root definitions were rejected. Minimum shared-validator change: GREEN17 passed,0 failed/skipped. Complete client-response-formats suite318 passed,0 failed/skipped (~1.3s), including both-base IAM/limits/admission/usage/outcome-audit/privacy and unsupported strict/tool/Anthropic paths. Only newly valid old key-rejection fixtures were replaced; dangling escaped-pointer and malformed reference fixtures remain.

Standard npm run check could not start: native npm launcher permission denied (exit126, pre-existing empty/nonexecutable file); explicit native Node npm-cli failed exit7 with missing walk-up-path. Shared tool installations were not modified. This is NOT a passing full gate. Prior624 full local typecheck/all-tests resource failures are not resolved or claimed passing by this slice. CI and formal exact-head approval remain mandatory. Local Docker/bridge/systemd/live providers remain uncertified.

Separate full repository typecheck PASSED (exit0): GOMAXPROCS=2 timeout120s native Node22 node_modules/typescript/lib/tsc.js --noEmit. This does not repair npm or establish full test-gate success. Final lint PASS42 existing warnings/121 infos; planning/link/contracts/fixture-secret scan PASS; all six offline pins PASS; git diff --check PASS. Logs /tmp/opengranter-626-{red,green,formats-green,check,check-native,typecheck,lint,docs,pins}.log.
