# Repository Instructions

Write and maintain all repository instructions, planning documents, domain documentation, and contract descriptions in English. `CLAUDE.md` is a symbolic link to this file; edit `AGENTS.md` as the single source of truth and preserve that link.

For every repository change, follow [CONTRIBUTING.md](CONTRIBUTING.md): issue first, a new issue-numbered branch, then a pull request. Never commit directly to `main`. Use the defined branch and commit names. Disclose material AI assistance with `Assisted-by: Codex`. The contributor `sjungwon03` has explicitly authorized Codex to add `Signed-off-by: sjungwon03 <sjungwon03@gmail.com>` to commits prepared for their requested work. Use that identity for both author and committer on those commits. Do not sign off as an agent or apply another person's DCO trailer without their authorization.

Pull requests to `main` require CI and at least one approval. The repository triage workflow labels issues and pull requests, assigns each issue and pull request author, and requests `sjungwon03-ai` on every pull request including drafts. Keep this automation on trusted base-branch code; never execute an untrusted pull request head with a write-capable token.

Changes must follow the scope in `docs/PRD.md` and the acceptance criteria in `docs/acceptance.md`. Do not implement unresolved options in `docs/architecture.md` as settled requirements.

For every implementation issue, write or update an English plan in `docs/plans/<issue-number>-<topic>.md` before coding. Use [the plan template](docs/plans/TEMPLATE.md), link the plan in the pull request, and update the relevant PRD, architecture, acceptance, and contract documents when their behavior changes. Keep unresolved decisions explicit.

Implement the product in TypeScript. Follow [the coding rules](docs/coding.md), keep the TypeScript strictness settings enabled, and use `CONTEXT.md` names in code. Python is limited to the existing planning-document checker until it is replaced.

When revisiting the plan, read `skills/grill-with-docs/SKILL.md` and its dependencies, `skills/grilling/SKILL.md` and `skills/domain-modeling/SKILL.md`. Record agreed domain terms in `CONTEXT.md` as they are resolved. Record only decisions that are costly to reverse, surprising without context, and the result of a genuine trade-off in `docs/adr/`. Do not turn unanswered questions into requirements.

## Change workflow

1. Record the issue and its implementation plan before coding; update acceptance scenarios and contract cases for changed behavior.
2. Follow test-driven development for every production-code change: write a meaningful test that fails for the expected reason, run it and record the failure, make the smallest implementation that passes, then refactor while keeping tests green. For a bug, reproduce it with a failing regression test first.
3. For authorization, authentication, secrets, and usage accounting, verify success, denial, and failure paths. Test through public boundaries rather than repeating implementation logic.
4. Run `npm run check`, which includes type checking, linting, tests, and the planning-document checker. For documentation-only changes, update the relevant plan or documentation and run the applicable checks; a production-code test is not required when behavior does not change.
5. Link the plan and report red/green evidence, validation results, and material remaining risks in the pull request.

## Security invariants

- Deny by default; an explicit Deny overrides Allow. Administrators do not bypass policy evaluation unless a product policy explicitly defines that behavior.
- Never put provider API keys or user tokens in logs, audit events, or error messages. Store prompt and response bodies only in the protected content-audit store when content auditing is explicitly enabled. Keep them out of operational logs, event bodies, and errors.
- Never commit secrets to fixtures, documentation, or Git. Store a reference to each provider key in a secret manager.
- Process model calls in this order: authenticate, resolve approved route candidates, evaluate policy for the complete enforceable destination scope, check limits, call the selected upstream. Audit denials and configuration changes.
- Distinguish estimated cost from provider-billed cost. Surface missing usage data and possible duplicate accounting.
- Call only upstream hosts registered and allowed by an administrator. Never proxy an arbitrary URL supplied by a caller. Reject routing overrides that could reach an unevaluated model, provider, or region.

## Initial scope

The initial release serves one organization through an OpenAI-compatible chat API. It supports an OpenRouter-delegated route and managed selection among direct OpenAI, Anthropic, and Google Gemini routes. Fallback stays within one route kind. Model and final inference-provider permissions both apply. Multitenancy and full support for provider-specific APIs require later decisions. Authorization uses an internal IAM-style policy engine; direct integration with AWS IAM is outside scope.
