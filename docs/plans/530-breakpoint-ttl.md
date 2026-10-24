# Explicit Text Cache Breakpoint TTL

## Issue and problem

- Issue: #530; refs #116.
- The reviewed request source pin v33 contains optional `PromptCacheBreakpoint.ttl: string | null`, but the runtime rejects every TTL. Existing managed OpenAI/delegated OpenRouter text markers already preserve exact histories and shared controls.
- Current official OpenAI Chat Completions documentation specifies optional per-breakpoint `30m` and `12h`. OpenRouter's source is broader; this issue implements a documented local subset, not arbitrary string support or live capability certification.

## Scope and expected behavior

- Accept explicit text markers with optional `ttl: "30m" | "12h" | null` on both `/v1` and `/api/v1`. Capture an own TTL once, normalize null/undefined to omission locally, freeze the marker, and forward supplied allowed values without defaulting or changing root options.
- Preserve all five history roles, exact text/order/empty blocks, correlated function results, nonstream and text/refusal/function streaming. Different supported breakpoint TTLs stay independent of root options; no local cache allocation, billing or retention guarantee is introduced.
- Keep existing auth/IAM/Deny/limit/audit/usage/cancellation behavior and private operational projections. Anthropic/Gemini reject marked histories before credentials. Existing image/refusal/prediction/mixed-format restrictions remain.
- No source-pin, dependency, migration, new secret, event or accounting schema changes. #7 and full #116 remain open. PR #529 is independent and must merge only after current-head approval and passing CI.

## Design

- Extend the shared `PromptCacheBreakpoint` snapshot only. Existing external parsers, internal message snapshots and registered invokers already use it; inspect actual request bodies to verify preservation rather than adding duplicate serializers.
- Preserve explicit empty/default distinctions: omit null/undefined locally and retain an absent TTL as absent, with no conversion into Anthropic cache controls or Google cache resources.
- Use the fixed two-value union instead of unrestricted strings because native OpenAI documents those values and the gateway already supports a bounded subset. Leave broader upstream values as explicit follow-up compatibility work.
- Update the existing breakpoint contract, PRD, architecture, acceptance, compatibility inventory and handoff. No new domain term or costly architectural trade-off warrants a glossary change or ADR.
- Sources fetched 2026-10-25: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [official OpenRouter schema](https://openrouter.ai/openapi.json). Preserve the raw nullable string in the source pin; do not insert local enums into it.

## TDD plan

- First write public HTTP/internal tests expecting preserved `30m`/`12h`, null/omission behavior and credential-time TTL capture. Run them against the old implementation and record expected rejection failures.
- Cover invalid type/value/extra fields, TTL getters, prototype rejection, both bases/routes/modes, auth/implicit/model/provider Deny, limits, selection/audit/usage failures, missing usage and native pre-secret rejection. Retain existing full cancellation/failure coverage.
- Test actual installed SDK sockets and inspect serialized request bodies. If the pinned SDK cannot serialize a new field, record the measured limitation and add an explicit supported raw-field path rather than claiming typed support or upgrading dependencies silently.
- Implement the smallest shared snapshot change. Update the earlier invalid `30m` fixture to an unsupported TTL because it is now a valid contract case; keep all other earlier assertions.
- Format touched TypeScript, run focused cache/provider/SDK regressions, then `npm run check`; verify unchanged source-pin bytes and update this plan with red/green evidence.

## Delivery

1. Issue, new branch and this plan before implementation.
2. Meaningful failing TTL and capture tests; minimal shared implementation.
3. Actual SDK conformance, security/failure regressions and English contract updates.
4. Required checks, user-authored/DCO/Assisted-by commit and ready PR linked to this plan.
5. Require approval on current SHA and successful CI before merge; independently integrate #529 only after it is approved and merged.

Risks: cache support and cost vary by upstream/model; never infer cache writes, hits, savings, billed cost or deletion deadlines from a request TTL. Omission/null normalization is local. Rollback removes this optional runtime field and its tests/contracts together while preserving prior marker behavior.

## Verification checkpoint

- Red: 44 new boundary cases ran against the old runtime: 36 failed with expected valid-TTL rejection and 8 passed. Log: `/tmp/opengranter-530-red.log`.
- Corrected fixture-only expectations: legitimate streamed provider text/probabilities contain the word private, so privacy checks match specific request strings rather than banning provider output; the established native unsupported-marker response is502, not400 after valid parsing. No production response or safety boundary was weakened.
- Green: initial raw/internal/actual SDK and existing breakpoint suites passed175 cases. Additional mixed-lifetime cases and full validation follow.
- Pinned OpenRouter1.4.18 removes TTL during generated serialization; actual sockets explicitly record that limitation. Raw HTTP and installed OpenAI7.23.0 sockets preserve TTL. No dependency update or implicit SDK workaround was added.
- PR #529 was approved on its current head with all three checks successful, merged as db31938, and integrated by fast-forward with the work temporarily preserved/restored. This issue leaves all six approved pin files unchanged.

## Focused verification

New mixed-lifetime ordering/no-default cases and all related cache/SDK suites passed1,198 tests with zero failures/cancellations. Command: `node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/breakpoint-ttl.test.ts test/sdk-breakpoint-ttl.test.ts test/*cache*.test.ts`; log `/tmp/opengranter-530-focused.log`. Type checking, formatting, planning/link/contract/fixture-secret and whitespace checks passed. Production diff remains the eight-line shared snapshot extension; all six source pins, dependencies and migrations are unchanged relative to approved main db31938. Full gate results follow after completion.

## Final verification

On approved main db31938 plus this change, `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 7,168 total, 7,167 passed, one optional external PostgreSQL skip, zero failures/cancellations. Types, lint, planning/link/contract/fixture-secret checks and all six offline pin checks passed. Existing unrelated lint warnings remain. Log: `/tmp/opengranter-530-check.log`. Explicit fresh `npm run compatibility:drift` also passed all six selections (`/tmp/opengranter-530-live.log`). All six pin files, dependencies and migrations remain byte-identical to approved main.
