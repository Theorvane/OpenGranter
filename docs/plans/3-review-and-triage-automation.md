# Review and Triage Automation

## Issue and problem

- Issue: [#3](https://github.com/Theorvane/OpenGranter/issues/3)
- OpenGranter currently allows a pull request to satisfy branch protection without an approving review. Labels, reviewer requests, and pull request assignees are manual.
- OpenScene's `dev` ruleset requires one approval, and its trusted review-request workflow assigns the author and requests `sjungwon03-ai`.

## Scope and expected behavior

- Require one approving review for pull requests into `main`, alongside the existing `check` status and resolved review conversations.
- Use a trusted GitHub Actions workflow to label issues from title prefixes and pull requests from issue-numbered branch prefixes. Preserve unrelated labels and avoid duplicate API changes.
- Add a triage label to new issues. When a ready pull request opens, reopens, becomes ready, or receives a new commit, request `sjungwon03-ai`, assign the author, and mark review requested.
- If `sjungwon03-ai` authors a pull request, omit the impossible self-review request and leave the required independent approval in place.
- Keep the existing `main` branch strategy and issue-to-branch-to-PR workflow. Do not adopt OpenScene's release branches or automatic merge.
- The automation does not read provider keys, customer prompts, or runtime audit data. It changes repository metadata only.

## Design

- Run `issues` and `pull_request_target` jobs only against trusted repository code. The workflow never checks out or executes a pull request head. Give its token only the issue, pull request, and read-only contents permissions needed.
- Keep label classification and reconciliation as pure TypeScript functions with tests. The workflow entry point reads a GitHub event payload and applies only computed metadata changes through the GitHub API.
- Map `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, and `security` prefixes to a small set of `type:*` labels. Use `area:ci` and `area:security` when those prefixes are explicit. Unknown issue titles receive `status:needs-triage` without a guessed type.
- Keep GitHub's required review as the merge gate. A review-request label is informational and does not stand in for approval.
- Update `CONTRIBUTING.md`, the issue form, and the pull request template with the conventions.

## TDD plan

- First write tests that fail because the label classifier and reconciliation module does not exist. Cover recognized and unknown prefixes, unrelated-label preservation, obsolete managed-label removal, and idempotency.
- Add tests for the event planner so draft pull requests do not request review, ready pull requests request the reviewer and assign the author, and self-review is skipped.
- Implement the smallest pure module that passes the focused tests, then refactor and run `npm run check`.
- Validate the workflow syntax and inspect the configured ruleset and live pull request metadata after publishing.

## Delivery

- Create labels and raise the `main` ruleset approval count to one.
- Add the workflow and TypeScript automation, test cases, and contribution documentation.
- Publish through a pull request linked to issue #3. Because the planning baseline is still in draft PR #2, base this PR on its branch and retarget it to `main` after the baseline merges.
- Risk: GitHub runs a new `pull_request_target` workflow only after it reaches the trusted base. Existing issues and pull requests need a one-time metadata update; verify them separately.
