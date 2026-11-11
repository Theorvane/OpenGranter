# Audit navigation context

## Issue and problem

Issue #867 (Refs #637): the reviewed public workspace at 2591928 mounts the Account identity reader when Audit is selected. Its heading and account-only guidance obscure the actual destination before authentication and on identity failures.

## Scope and expected behavior

Keep the Audit heading throughout signed-out, expired, denied, loading and unavailable identity states. Account keeps its existing heading and guidance. Do not change identity validation, transport, grants, audit permissions, session/bootstrap activation or HTTP contracts.

## Design

Give the bounded principal reader an explicit optional Audit context. The workspace supplies it only for the Audit prerequisite; the default remains Account. Keep the existing cancellation, retry and stale-response protections. No new reader or endpoint.

## TDD plan

First add workspace regression tests asserting Audit headings and absence of Account-only guidance before authentication, while resolving identity and after identity failures. Confirm failure against the original implementation. Cover Account navigation, expiry, denial and successful audit loading with existing regression suites. Implement only presentation context and run targeted tests, typecheck, lint and public bundle build.

## Delivery

Stack this focused follow-up on the owned FE artifact 2591928 to preserve runtime reproducibility; no runtime source edits. Report exact base/head and browser evidence separately from fixture tests. A public-only preview cannot establish authenticated API acceptance. Rollback is the context option and its single call-site; authority behavior is unchanged.
