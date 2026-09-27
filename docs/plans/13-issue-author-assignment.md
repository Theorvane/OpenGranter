# Assign Issue Authors During Triage

## Issue and problem

- Issue: [#13](https://github.com/Theorvane/OpenGranter/issues/13)
- The trusted triage workflow labels new issues and assigns pull request authors, but issue authors are not assigned. This leaves newly opened issues without an obvious owner.

## Scope and expected behavior

- In scope: assign the issue author on opened, edited, and reopened issue events when not already assigned; keep all other assignees and existing label behavior. Backfill currently open issues manually as part of delivery.
- Out of scope: changing pull request assignment or reviewer rules, removing assignees, creating GitHub permissions for users who cannot be assigned, or executing issue text.
- The handler reads current issue metadata from GitHub, compares logins case-insensitively, and posts the author to the issue-assignees endpoint only when absent. A failed assignment remains visible as a workflow failure after labels have been processed.

## Design

- Keep the existing `issues` event trigger and trusted `main` checkout. The workflow already has `issues: write` permission, so no permission expansion is needed.
- Add a pure author-assignment planner alongside the label planner. The event handler uses live issue author and assignee fields from the GitHub API, then applies labels and a single additive assignee request.
- GitHub's [issue assignees API](https://docs.github.com/en/rest/issues/assignees) supports `POST /repos/{owner}/{repo}/issues/{issue_number}/assignees` with an `assignees` array. Preserve the existing assignee list; never replace it.
- Update [the engineering harness](../harness.md) and `CONTRIBUTING.md`. No product architecture or ADR change is needed.

## TDD plan

- First add a failing planner test for absent author assignment and idempotence with an existing mixed-case author login.
- Extend the issue-event handler test to assert one additive assignee POST after existing labeling. Cover an edited issue with another assignee and a repeated event with the author already assigned.
- Implement the smallest planner and handler change, then run the focused test, `npm run check`, and `git diff --check`.

## Delivery

- Commit to `ci/13-issue-author-assignment` with the contributor's DCO and AI assistance trailers; open a ready PR linked to #13 and this plan.
- The workflow runs from trusted base-branch code. Current open issues #7, #11, and #13 are backfilled to their author before this PR; new issue events use the workflow after merge.
