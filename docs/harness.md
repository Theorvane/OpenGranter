# Engineering Harness

The service is not yet implemented. The harness captures requirements as executable cases and detects documentation and contract errors in CI. Pure TypeScript policy evaluation and candidate authorization are the first implementation slices.

Planning interviews use [grill-with-docs](../skills/grill-with-docs/SKILL.md). Its [grilling](../skills/grilling/SKILL.md) dependency runs question rounds, while [domain-modeling](../skills/domain-modeling/SKILL.md) maintains the glossary and ADRs. Agreed terms live in [CONTEXT.md](../CONTEXT.md).

## Current checks

Run `npm run check` to type-check and lint TypeScript, run policy and route-authorization contract tests, and call `python3 scripts/check.py` to validate:

1. Required planning documents and internal links.
2. Required fields and unique IDs in policy, route, and gateway contract cases.
3. Policy-case expectations against default denial and explicit Deny precedence.
4. Common real-credential patterns in documentation and contract fixtures.
5. English-only repository documents and contract descriptions.
6. `CLAUDE.md` remains a symbolic link to `AGENTS.md`.

`.github/workflows/check.yml` runs the same command on pushes and pull requests. This does not replace service security tests or a production secret scanner.

## Implementation connections to add

- Extend `contracts/policy_cases.json` and `contracts/route_cases.json` as policy features are agreed; the current cases execute against the pure evaluator and candidate filter.
- Execute `contracts/gateway_cases.json` against an HTTP test server, a fake OpenRouter upstream, and fake OpenAI, Anthropic, and Gemini upstreams. Assert that each route kind uses the same IAM decision and audit path, that `provider.only` cannot be widened, and that fallback never crosses route kinds.
- Add integration cases for authentication, secret-store failures, ledger and audit write failures, and concurrent calls.
- Add migration and retention checks to CI.

When changing an expected contract outcome, review the [PRD](PRD.md) and [acceptance scenarios](acceptance.md) together. Do not change an expected outcome merely to match an implementation bug.
