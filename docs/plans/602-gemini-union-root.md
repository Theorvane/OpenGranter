# Bounded Gemini union-root response schemas

Issue #602, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend explicit strict:false transport to untyped anyOf/oneOf roots with 1..16 recursively validated branches. Permit existing root-only $defs at these roots; nested definitions, root references, root null and unsupported keywords remain rejected before credentials. Reuse existing expanded depth<=16 and shared20,000-visit budget including definition expansion. Preserve captured schema unchanged on nonstream/native text streams, IAM/limits/accounting/persistence/privacy. No output validation, satisfiability, oneOf exclusivity guarantee, schema equivalence or live-model certification. Upstream treats oneOf like anyOf; this is transport only. No dependencies/pins/storage/#561 changes; full #116 and unresolved #7 remain open.

Official GenerationConfig source: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists anyOf/oneOf and root definitions; responseJsonSchema remains deprecated. Existing nested union contract applies at the root without resolving or rewriting schemas.

## TDD and delivery

Plan in checkout before tests/source. Meaningful red for both-base immutable HTTP, actual SDK sockets and native streams, IAM/limits/persistence/privacy. Cover union branch counts, malformed keywords, local refs, cycles/external refs, expanded depth/shared traversal bounds and strict/tool/Anthropic pre-secret rejection. Supersede only historical root-union negatives. Minimal source change then focused tests, standard full npm run check, types/lint/docs/pins without weakened assertions/deadlines/concurrency. Exact-head formal independent approval plus all CI success before normal merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Meaningful red before source edits:178passed and16expected failures in new both-base immutable HTTP, IAM/persistence, actual OpenAI SDK socket and native text-stream cases. Minimal root guard/root-only definitions change then189/194passed; five historical root-union-only negatives were superseded with acceptance or genuinely unsupported child assertions. No unrelated negative was removed.
- Expanded union branch counts, wrong-keyword/malformed branches, local refs, cycles/external refs, expanded depth, definition count and shared traversal-budget checks plus strict/tool/Anthropic pre-secret rejection. Format suite198passed; final format/native text stream/actual AI SDK structured selection260passed, zero failures. Both object JSON and literal null text are fixture transport only, not generated-output guarantees.
- Standard full taskset-c0,1 npm run check FAILED:8,364passed,3file-level SIGKILL failures and one optional external PostgreSQL skip (~247seconds). Failed files:postgres-dual-http-server,postgres-sso-management-http,postgres-usage-ledger. No reported assertion failures. NOT a local full pass; no retries, weakened assertions, deadlines or concurrency changes. Cgroup memory.max2GiB and cumulative OOM kills are consistent with resource pressure but are not per-test proof.
- Typecheck/lint passed in the standard gate (existing42warnings67infos). Separate planning/link/contracts/fixture-secret scan and all six offline pin integrity checks passed; whitespace passed. Logs:/tmp/opengranter-602-{red,green,updated,negatives,focused,full,format,docs,pins}.log. Evidence-only doc additions follow the full run; final documentation scan rerun. No local Docker/bridge/systemd/live-provider certification; exact-head independent formal approval and all CI success still mandatory.
