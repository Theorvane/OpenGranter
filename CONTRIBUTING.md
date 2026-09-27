# Contributing to OpenGranter

All repository documents and contribution discussions in issues and pull requests are written in English.

## Issue, branch, pull request

1. Open or select a GitHub issue before starting a change. Record the problem, expected behavior, and acceptance criteria. Security reports that would expose a vulnerability should use GitHub's private vulnerability reporting instead of a public issue.
2. Create a new branch from the current `main` for that issue. Do not commit directly to `main`.
3. Before implementation, add an English issue-specific plan under `docs/plans/` using [the plan template](docs/plans/TEMPLATE.md). Update existing product planning documents and acceptance scenarios when the proposed behavior changes. Record open questions instead of silently deciding them in code.
4. Work in a red–green–refactor cycle for every production-code change: add a meaningful failing test or contract case, run it and confirm the expected failure, implement the smallest passing change, then refactor while the tests remain green. For bugs, first add a failing regression test. Cover security-critical success, denial, and failure paths. Do not rewrite a test solely to make an incorrect implementation pass.
5. Keep each commit focused and run `npm run check` before opening a pull request. Documentation-only changes do not require a new production-code test, but must pass the applicable document checks.
6. Open a pull request against `main` that links the issue with `Closes #<number>` when merging the PR will fully resolve it, or `Refs #<number>` otherwise. Link the plan and record the red/green test evidence, verification, and material risks. Wait for checks and review before merging.
7. Use a new issue and branch for follow-up work. Do not reuse a merged branch.

## Implementation plans

Name each plan `docs/plans/<issue-number>-<short-kebab-case-topic>.md`. The plan states the problem and scope, user-visible behavior, permission and audit impact, affected contracts, test cases to write first, implementation steps, risks, and unresolved decisions. Keep it concise and revise it when the implementation changes. Link the plan from the pull request so the reason for the code remains reviewable. An issue may link a shared plan when several issues implement the same agreed design; each pull request must identify the plan and its specific scope.

### Branch names

Use `<type>/<issue-number>-<short-kebab-case-topic>`. Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `security`.

Examples:

- `feat/42-proxy-token-issuance`
- `fix/57-denied-provider-fallback`
- `docs/61-audit-retention-policy`

Keep the topic short, lowercase, and specific. The issue number is mandatory. Branches used to prepare the initial repository bootstrap are the sole exception because an issue cannot exist before the repository exists.

## Commits

Use the form `<scope>: <imperative summary>`, for example `routing: restrict fallback providers`. Scope names should identify the changed subsystem, such as `policy`, `routing`, `gateway`, `audit`, `docs`, or `build`. Keep the subject at or below 72 characters; prefer 50 or fewer. Use lowercase except for proper names, acronyms, and code identifiers. Add a blank line and a body explaining why when the subject is insufficient. Wrap body lines at 72 columns, except URLs.

Every contribution must include a `Signed-off-by: Name <email>` trailer for the human contributor who certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Contributors can add it with `git commit -s` or explicitly authorize an agent to apply their trailer to work prepared for them. OpenGranter's contributor `sjungwon03` has given that standing authorization for `Signed-off-by: sjungwon03 <sjungwon03@gmail.com>` on their requested work. Match the author and committer identity to that account. Never invent another contributor's authorization or sign off as an agent. Resolve uncertain ownership or third-party provenance before signing. A sign-off is a rights and provenance certification, not a cryptographic GPG/SSH commit signature.

Without a contributor's explicit authorization, an agent may push a provisional unsigned commit to a draft pull request for review. Before merge, a human contributor must review and sign it or explicitly authorize the agent to apply their sign-off. An authorized sign-off does not replace human code review.

When an AI tool materially assists, add `Assisted-by: <tool or agent name>` as a separate trailer. For this repository, `Assisted-by: Codex` is sufficient when Codex assists. This reports assistance; it does not assign authorship, DCO responsibility, or a review. Do not use `Co-authored-by` for an AI tool. Human co-authors may use `Co-authored-by` and must each provide their own DCO sign-off if their contribution is included.

Example:

```text
routing: bound OpenRouter provider fallback

Keep the upstream provider set inside the caller's evaluated IAM scope.

Refs: #57
Assisted-by: Codex
Signed-off-by: Example Contributor <contributor@example.com>
```

The example identity is illustrative. Contributors must use their own verified name and email. To amend a commit after reviewing it, a human can run `git commit --amend -s` and verify the trailers with `git log -1 --format=%B`.

## Review and merge

Require the repository checks and at least one human review. Use squash merge by default, preserving the issue reference, `Assisted-by` trailer when applicable, and a human `Signed-off-by` trailer in the resulting commit. Configure GitHub branch protection or rulesets for `main` after the repository is created. Neither the presence of an `Assisted-by` trailer nor passing CI substitutes for review.

These conventions take inspiration from [Node.js commit guidelines](https://github.com/nodejs/node/blob/main/doc/contributing/pull-requests.md) and its [agent disclosure guidance](https://github.com/nodejs/node/blob/main/AGENTS.md). OpenGranter's workflow and enforcement are defined by this document.
