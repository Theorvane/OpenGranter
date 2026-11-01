# Bounded Gemini definition-local anchors

Issue #608, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Accept unique $anchor names only on direct root-$defs entries and local #name references to those definitions under explicit strict:false. Names use the existing conservative 1..64 ASCII definition-name grammar. No root/nested anchors, anchors on reference nodes, $id, URI resolution or remote fetch. Pointer and anchor references resolve to the same canonical definition name for cycle detection. Validate all unused definitions and retain expanded depth<=16, shared20,000 visits and 128-definition bound. Preserve exact immutable schemas. All recursive type/keyword restrictions remain; no output validation, satisfiability, equivalence, forced output or live-provider certification. No pins/dependencies/storage/#561 edits. Full #116 and unresolved #7 stay open.

Fresh primary source: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists $anchor/$ref in the limited schema subset and deprecates responseJsonSchema. This conservative subset does not certify all JSON Schema scope rules.

## TDD and delivery

Plan written in actual checkout before tests/source. Reproduce both-base immutable HTTP, actual OpenAI SDK sockets and captured native streams. Add direct validator tests for missing/malformed/duplicate/nested anchors, mixed pointer/anchor cycles, unused definitions, prototype-like names and depth/count/shared-budget boundaries. Retain IAM/limits/persistence/privacy and strict/tool/Anthropic pre-secret controls. Minimal production change after meaningful red; focused tests and standard full npm run check without weakened assertions/deadlines/concurrency. Record local failures honestly. Exact-head independent formal approval and all CI success before normal merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Plan exists in actual checkout before tests/source. Initial format red:229passed,8expected failures. Minimal mapper delta made237pass. Added malformed/duplicate/nested/ref-sibling/unused definitions, mixed pointer/anchor cycles, root-only restrictions, both-base pre-secret HTTP and native stream rejection, strict/tool/Anthropic controls, own prototype-like names, all concrete/nullable/union targets, namespace distinction, definition/name/depth/shared-budget bounds. Focused format/native text-stream/actual AI SDK selection302passed, zero failures.
- Standard taskset-c0,1 npm run check FAILED:8,395passed,6file-level SIGKILL failures,1optional external PostgreSQL skip (~252seconds). Failed files:model-descriptive-metadata,model-details-links,model-discovery-metadata,postgres-sso-management-http,postgres-sso-management-runtime,proxy-token-lifetime-caps. No reported assertion failures. NOT a local full pass. No full-gate retry, concurrency/deadline/assertion weakening after failure. The2GiB cgroup and cumulative OOM counters are consistent with resource pressure, not per-test causation proof.
- After the full gate, strengthened positive schema-privacy assertions to include actual anchor/definition names and added exact expanded-depth16accept/17reject checks without production edits. Final focused302passed; separate typecheck, new-test formatting, planning/link/contracts/fixture-secret scan and all six offline schema-integrity checks passed. Full-gate typecheck/lint passed with existing42warnings67infos. Final documentation evidence requires one final planning/whitespace scan before commit.
- Logs:/tmp/opengranter-608-{red,green,focused,full,final-focused,types,format,docs,pins}.log. No local Docker/bridge/systemd/live-provider certification. Exact-head independent formal approval and all CI success required before normal merge.
