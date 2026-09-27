# Contributing to OpenGranter

All repository documents and contribution discussions in issues and pull requests are written in English.

## Issue, branch, pull request

1. Open or select a GitHub issue before starting a change. Record the problem, expected behavior, and acceptance criteria. Security reports that would expose a vulnerability should use GitHub's private vulnerability reporting instead of a public issue.
2. Create a new branch from the current `main` for that issue. Do not commit directly to `main`.
3. Add or update acceptance scenarios and contract cases before changing behavior. Keep each commit focused and run `npm run check` before opening a pull request.
4. Open a pull request against `main` that links the issue with `Closes #<number>` when merging the PR will fully resolve it, or `Refs #<number>` otherwise. Describe the change, verification, and material risks. Wait for checks and review before merging.
5. Use a new issue and branch for follow-up work. Do not reuse a merged branch.

### Branch names

Use `<type>/<issue-number>-<short-kebab-case-topic>`. Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `security`.

Examples:

- `feat/42-proxy-token-issuance`
- `fix/57-denied-provider-fallback`
- `docs/61-audit-retention-policy`

Keep the topic short, lowercase, and specific. The issue number is mandatory. Branches used to prepare the initial repository bootstrap are the sole exception because an issue cannot exist before the repository exists.

## Commits

Use the form `<scope>: <imperative summary>`, for example `routing: restrict fallback providers`. Scope names should identify the changed subsystem, such as `policy`, `routing`, `gateway`, `audit`, `docs`, or `build`. Keep the subject at or below 72 characters; prefer 50 or fewer. Use lowercase except for proper names, acronyms, and code identifiers. Add a blank line and a body explaining why when the subject is insufficient. Wrap body lines at 72 columns, except URLs.

Every human-authored commit must include a `Signed-off-by: Name <email>` trailer matching a human author or co-author who personally certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/). The person signing off must review the change and add the trailer themselves, normally with `git commit -s`. A sign-off is a rights and provenance certification, not a cryptographic GPG/SSH commit signature. Agents must never add a human's sign-off on that person's behalf or sign off as an agent.

An agent may push a provisional unsigned commit to a draft pull request for review. Before merge, a human contributor must review the final change and create or amend the commit with their own sign-off. Do not treat the provisional commit as DCO certified.

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
