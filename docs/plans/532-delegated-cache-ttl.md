# Delegated 12-Hour Request Cache TTL

## Issue and problem

- Issue: #532; refs #116 and #7.
- The official OpenRouter Chat Completions page describes request-level30m/12h, while the gateway's explicit cache options permit only30m. The pinned OpenRouter SDK already serializes a nullable string TTL.
- PR #531 merged as6ce0f33 after exact-head approval and all required checks. Its per-text-breakpoint TTL support is separate and remains unchanged.

## Scope and expected behavior

- Accept `prompt_cache_options={mode:"explicit",ttl:"12h"}` on delegated OpenRouter nonstream/text/refusal/function streaming through both client bases. Retain existing30m, omission/null normalization, explicit-only mode and no-default behavior.
- Capture/freeze known own fields before credentials, preserve text breakpoints independently, and retain approved destination IAM, limits, audit, per-attempt usage and content privacy.
- Keep direct OpenAI's current30m subset and reject root12h before credentials on all direct modes. Native OpenAI's current Chat Completions reference only declares30m; the guide's root12h examples explicitly concern Responses. Anthropic/Gemini retain their existing supplied-options rejection.
- No new endpoints, native cache conversion, source-pin, migration, dependency, event or accounting schema changes; no live cache/billing/retention certification. Broader strings, implicit mode, direct-native12h and full #116 remain open.

## Design

- Extend the shared snapshot's two-value union, then apply a direct-adapter guard before credential access wherever root options are prepared. Inspect all registered stream adapters so accepting the shared field cannot widen native behavior inadvertently.
- Use existing bounded root serialization and route-specific preparation; no caller-provided TTL selects a route, host, provider, model or region. Same-kind fallback remains unchanged.
- Cover public SDK sockets: typed OpenRouter serialization, and OpenAI SDK transport of the extension when pointed at a delegated gateway. Do not claim that sending the extension via that client proves native OpenAI support.
- Update the existing root-options contract, PRD, architecture, acceptance, compatibility and handoff. No new domain term or expensive architectural trade-off is introduced.
- Official sources checked2026-10-25: [OpenRouter chat](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), [OpenAI chat](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [OpenAI guide](https://developers.openai.com/api/docs/guides/prompt-caching). Preserve the source pin's nullable unconstrained string, not a local enum. Keep the API-specific documentation discrepancy explicit.

## TDD plan

- First run public/internal/SDK cases that expect delegated12h preservation against current main and record valid-option rejection. Include direct route denial tests before extending the shared parser so a missing native guard fails visibly.
- Test both bases and supported output modes, no implicit/default changes, independent text-boundary TTL, getter/mutation capture, invalid values, auth/implicit/model/provider Deny, limit/selection/audit/usage failure, missing usage, transport failure and existing cancellation behavior.
- Verify all direct provider stream modes reject root12h before secrets/upstream calls, while direct OpenAI30m remains usable.
- Implement the minimum shared snapshot and direct guard changes, format touched TypeScript, run focused cache/SDK/provider regressions, then `npm run check` and record evidence.

## Delivery

1. Issue/new branch/this English plan before coding.
2. Red tests; smallest shared acceptance and native restriction changes; green tests.
3. Contract/acceptance/handoff updates and all required validation.
4. Ready PR with linked plan, red/green evidence, SDK/source distinctions and risks; user author/committer, DCO and Assisted-by trailers.
5. Require approval on the current SHA and successful CI before merge.

Risks and rollback: TTL forwarding cannot establish model eligibility, cache writes/hits, saved cost, billed cache rates or deletion deadlines. Revert the shared enum extension and direct guards together to restore the prior30m subset. Direct API scope differences are intentional until their own evidence supports expansion.

## TDD evidence

- Initial red: all46 new boundary/SDK cases failed against main because root12h was rejected as invalid, including expected native unsupported-adapter outcomes. Log `/tmp/opengranter-532-red.log`.
- Native guard red: after extending only the shared parser,18 direct-route cases produced12 passes and6 OpenAI failures because root12h reached native calls and returned200. Log `/tmp/opengranter-532-native-red.log`. This confirms the direct guard protects actual transport boundaries rather than relying on parser rejection.
- Green results and full gate will be recorded after validation. No fixture expectations or production responses were relaxed to satisfy these cases.

## Focused verification

The new delegated/native/actual SDK and existing root-option suites passed147 cases. All related cache/SDK and breakpoint suites passed1,244 cases, zero failures/cancellations (`/tmp/opengranter-532-focused.log`). Type checking, formatting, planning/link/contract/fixture-secret and diff whitespace checks passed. Production diff is limited to shared root-options acceptance and one common direct transport guard. All six existing source pins, dependencies, migrations and event/accounting schemas remain unchanged relative to approved main6ce0f33. Full gate results follow after completion.

## Final verification

On approved main6ce0f33 plus this change, `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 7,214 total, 7,213 passed, one optional external PostgreSQL skip, zero failures/cancellations. Type checking, lint, planning/link/contract/fixture-secret checks and all six offline pin checks passed. Existing unrelated lint warnings remain. Log: `/tmp/opengranter-532-check.log`. Explicit fresh `npm run compatibility:drift` passed all six selections (`/tmp/opengranter-532-live.log`). Existing pins, dependencies and migrations remain unchanged.
