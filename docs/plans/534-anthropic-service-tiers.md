# Direct Anthropic Service-Tier Requests

## Issue and problem

- Issue: #534; refs #116 and #7.
- Normalized service-tier requests currently reject every supplied value on direct Anthropic routes. Official Messages supports native `auto` and `standard_only`.
- PR #533 merged as78d5d29 after approval on its current SHA and all three checks. Delegated endpoint-scope restrictions are intentional and remain unchanged.

## Scope and expected behavior

- Map normalized `auto` to native `auto`, and normalized `default` to native `standard_only`, for direct Anthropic nonstream/text/refusal/function streaming through both client bases.
- Omission/null remains omission with no injected tier. Preserve exact one-time primitive capture before route/credential awaits and the existing normalized public enum. Do not accept raw `standard_only` at the public boundary.
- Other recognized Anthropic tiers reject before credentials. Managed OpenAI, delegated OpenRouter and Gemini retain their existing tier subsets. No new endpoint/model/provider/region authority, beta header or native speed-mode mapping.
- Preserve current IAM/Deny/limits, private audit/accounting, native output caps, missing usage, possible-billing failures and cancellation. Do not echo request tiers as served metadata or infer capacity, latency, SLA, eligibility or billed prices.
- No source-pin, dependency, migration, event kind or accounting schema changes. Native served-tier response metadata remains separate follow-up work; full #116 and unresolved Jev #7 stay open.

## Design

- Extend only the common registered direct transport's pre-credential provider guard and its Anthropic body builder. All native nonstream/text/function invokers already share that preparation boundary.
- Use the two documented native capacity controls rather than guessing how normalized priority/fast/flex/scale map to them. Explicit default means standard-only capacity locally; it does not resolve model-specific eligibility.
- Existing shared HTTP/adapter literal validation and immutable capture remain intact. Use real native JSON/SSE fixture shapes behind actual registered invokers and socket SDK clients.
- Update the service-tier contract, PRD, architecture, acceptance, compatibility and handoff. This reversible adapter mapping adds no new domain term or costly architectural decision.
- Sources checked2026-10-25: [Anthropic service tiers](https://platform.claude.com/docs/en/api/service-tiers) and [Messages API](https://platform.claude.com/docs/en/api/http/messages/create). Keep the current2023-06-01 header; no API-version upgrade is part of this change.

## TDD plan

- Write failing public/internal/actual SDK cases expecting the two native mappings on both bases and supported modes. Record current unsupported-request failures before implementation.
- Test omission/null, exact default mapping without alias leakage, getters/mutation, unsupported and malformed tiers, auth/implicit/model/provider Deny, limits/selection/audit/usage failure, missing usage, opened upstream failure and cancellation. Existing OpenAI/delegated/Gemini subsets must remain green.
- Verify valid requests never synthesize served tiers from the requested value and keep tier data out of operational records/errors; verify fixed host/model/caps and no new native speed or region fields.
- Implement the smallest common guard/body changes. Narrow the earlier Anthropic unsupported-value fixture only for newly supported auto/default, leaving all other negative cases.
- Format touched TypeScript; run focused service-tier/native Anthropic/SDK regressions, `npm run check`, and relevant six-pin checks; record red/green and source limitations.

## Delivery

1. Issue/new branch/this English plan before coding.
2. Failing native-boundary tests, minimal implementation and green evidence.
3. English contracts/acceptance/handoff and required validation.
4. Ready PR with plan, evidence, risks, user author/committer, DCO and Assisted-by trailers.
5. Merge only after successful required CI and current-head approval.

Risks/rollback: native auto may use available priority capacity and is not a price or served-tier guarantee. This preserves the provider's omitted-value behavior rather than adding a new default. Revert admission and native mapping together to restore prior Anthropic rejection. Expanded delegated tiers still require endpoint-scope authorization design.

## TDD checkpoint

Red:36 new native-boundary/actual SDK cases produced34 expected failures and2 unsupported-value passes against main (`/tmp/opengranter-534-red.log`), before changing production code. Green: all138 new/existing service-tier and SDK cases passed after the common guard/body changes; type checking passed (`/tmp/opengranter-534-green.log`). The earlier Anthropic negative fixture excludes only newly supported auto/default and retains every other unsupported tier. No production response or privacy rule was weakened. Broader native regressions and the required full gate follow.

## Focused verification

Ten new/existing service-tier, registered native stream/function, native function-history/cache-usage and SDK suites passed410 cases, zero failures/cancellations (`/tmp/opengranter-534-focused.log`). Strict type checking, formatting, document/link/contract/fixture-secret and diff whitespace checks passed. All six pins, dependencies, migrations and operational event/accounting schemas are unchanged relative to approved main78d5d29. Full gate results follow after completion.

## Final verification

On approved main78d5d29 plus this change, `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 7,250 total, 7,249 passed, one optional external PostgreSQL skip, zero failures/cancellations. Type checking, lint, planning/link/contract/fixture-secret checks and all six offline pins passed. Existing unrelated lint warnings remain. Log: `/tmp/opengranter-534-check.log`. Explicit fresh `npm run compatibility:drift` passed all six selections (`/tmp/opengranter-534-live.log`). Existing pins, dependencies, migrations and event/accounting schemas remain unchanged.
