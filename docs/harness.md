# Engineering Harness

The deployable HTTP service is not yet implemented. The harness captures requirements as executable cases and detects documentation and contract errors in CI. Pure TypeScript policy evaluation, principal and role attachment evaluation, gateway attachment authentication, audit attribution, candidate authorization, Jev-assisted selection, managed invocation coordination, direct text-chat adapters, a chat HTTP handler, and a Node socket bridge are the current implementation slices.

Planning interviews use [grill-with-docs](../skills/grill-with-docs/SKILL.md). Its [grilling](../skills/grilling/SKILL.md) dependency runs question rounds, while [domain-modeling](../skills/domain-modeling/SKILL.md) maintains the glossary and ADRs. Agreed terms live in [CONTEXT.md](../CONTEXT.md).

Each implementation issue starts with an English plan in `docs/plans/` and an acceptance or contract case that can fail before the implementation changes. Run the focused test to confirm the expected red state, implement the smallest passing change, and refactor while green. The pull request links the plan and records the red/green commands and outcomes. Documentation-only changes run the document checks without inventing product tests.

## Current checks

Run `npm run check` to type-check and lint TypeScript, run policy, attachment, and route-authorization contract tests, and call `python3 scripts/check.py` to validate:

1. Required planning documents and internal links.
2. Required fields and unique IDs in policy, route, and gateway contract cases.
3. Policy-case expectations against default denial and explicit Deny precedence.
4. Common real-credential patterns in documentation and contract fixtures.
5. English-only repository documents and contract descriptions.
6. `CLAUDE.md` remains a symbolic link to `AGENTS.md`.

`.github/workflows/check.yml` runs the same command on pushes and pull requests. This does not replace service security tests or a production secret scanner.

`.github/workflows/triage.yml` runs against trusted `main` code with issue and pull request metadata permissions. It classifies issue title and pull request branch prefixes, adds a triage label to new issues, assigns issue and pull request authors without removing other assignees, and requests `sjungwon03-ai` on every pull request including drafts. The pure triage planner and event handler are covered by `test/triage.test.ts`. The label records are informational; the `main` ruleset enforces one approval and the `check` status.

## Implementation connections to add

- Extend `contracts/policy_cases.json` and `contracts/route_cases.json` as policy features are agreed; the current cases execute against the pure evaluator and candidate filter.
- Execute `contracts/gateway_cases.json` against an HTTP test server, a fake OpenRouter upstream, and fake OpenAI, Anthropic, and Gemini upstreams. Assert that each route kind uses the same IAM decision and audit path, that `provider.only` cannot be widened, and that fallback never crosses route kinds.
- Add integration cases for authentication, secret-store failures, ledger and audit write failures, and concurrent calls.
- Supply concrete token authentication, a route catalog, limit reservation, a secret store, and durable audit/usage writes behind the existing HTTP gateway ports. Wire the direct-provider adapters through those ports. Its current fake-port tests establish call order and failure behavior but are not a live provider test.
- The socket test exercises the Node HTTP bridge with fake identity, route, limit, secret, audit, and provider ports. Supply concrete implementations and execute the complete gateway contract before treating the service as deployable.
- Add migration and retention checks to CI.

When changing an expected contract outcome, review the [PRD](PRD.md) and [acceptance scenarios](acceptance.md) together. Do not change an expected outcome merely to match an implementation bug.
