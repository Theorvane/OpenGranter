# Bounded Gemini literal null-root schemas

Issue #606, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend explicit strict:false transport to literal type:null roots. Reuse recursive null-node restrictions, optional title/description, root-only definitions including unused-definition checks, local references, expanded depth<=16 and shared20,000-visit budget. Preserve schemas unchanged. No output validation, forced-null output, satisfiability, equivalence or live-model certification. Wrong-type keywords, null enums, malformed arrays, nested definitions, strict/tool/Anthropic remain pre-secret failures. No pins/dependencies/storage/#561 edits. Full #116 and unresolved #7 stay open.

Official source freshly checked: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists type and limited JSON Schema transport; responseJsonSchema remains deprecated. Existing nested/union/reference null transport is not live-provider certification.

## TDD and delivery

Issue scope was recorded before tests and source. A file-tool plan write landed outside the actual shell checkout; discovered and copied into the checkout after the initial red and minimal source guard change, before expanded tests. Do not claim checkout-plan-before-source chronology. Initial red:217passed,8expected new failures. Minimal root-type guard made221/225pass;4 historical root-null-only negatives require replacement with genuinely unsupported null assertions.

Add both-base immutable HTTP, actual SDK sockets, captured native streams, IAM/limits/persistence/privacy, unused-definition/depth/name/count/shared-budget and strict/tool/Anthropic cases. Focused and standard full npm run check without weakened assertions/deadlines/concurrency; report local failures honestly. Exact-head independent formal approval plus all CI success required before normal merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Initial meaningful red before source:217passed,8expected new failures. One root allowlist addition made221/225pass; four historical root-null-only negatives replaced with unsupported null enums, retaining all other negative coverage. Final format229passed; format/native text stream/actual AI SDK structured selection291passed, zero failures. Both-base immutable HTTP, actual OpenAI sockets, captured native streams, IAM/limits/persistence/privacy, unused definitions, depth/count/name/shared-budget bounds, strict/tool/Anthropic rejection and non-null generated-text pass-through are covered. These fixture responses do not certify live models.
- First full-gate invocation stopped at TS18046 in a new test: response.json() returns unknown. Added an explicit expected response type and optional element access without weakening the content assertion, then reran focused291pass and the standard full gate.
- Final standard taskset-c0,1 npm run check FAILED:8,382passed,2file-level SIGKILL failures,1optional external PostgreSQL skip (~247seconds). Failed files:postgres-sso-management-http and sso-token-management. No reported assertion failures; NOT a local full pass. No retry or concurrency/deadline/assertion weakening after these resource-like failures. Cgroup memory.max2GiB and cumulative OOM kills are consistent with resource pressure, not per-test causation proof.
- Typecheck/lint passed in the final gate (existing42warnings67infos). Separate planning/link/contracts/fixture-secret scan and all six offline schema-integrity checks passed; whitespace passed. Evidence-only docs updated after full gate; final doc scan required before commit. Logs:/tmp/opengranter-606-{red,green,negatives,focused,full,format,docs,pins}.log. No local Docker/bridge/systemd/live-provider certification. Exact-head independent formal approval and all CI success required before normal merge.
