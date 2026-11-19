# 642 History adapter initialization recovery

1. Scope: recover the existing approved-caller History screen when construction of its owned CSV download adapter throws. No session, authorization, API, schema, deployment or provider change.
2. Contract: show a generic alert and an explicit Retry history button. Each click retries construction once; only successful construction starts the existing usage GET. No mutation or CSV export is automatic.
3. Lifecycle: retry uses a new navigation epoch. Detached controls after retry, navigation, denial or disposal cannot start work. Reentrant disposal during construction cannot revive the screen or leak diagnostics.
4. Evidence: demonstrate RED without recovery, then GREEN with recovery, repeated failure, stale controls, teardown and denial cases. Run existing operations/session/history tests, full typecheck, lint and canonical browser build. Browser/synthetic HTTP evidence is distinct from installed SSO acceptance.
5. Delivery: independent main-based PR, exact-head required CI and valid formal independent approval before merge. Full PRD, installed acceptance and public user URL remain incomplete.

## Execution evidence

- RED: 9 existing tests passed, all 7 new recovery cases failed without the retry control.
- GREEN: 16/16 operations tests; operations/session/history regression 53/53, no skips.
- Native Chromium with canonical browser artifact and synthetic loopback HTTP: failure displayed generic alert and Retry history with zero reads; explicit retry mounted empty usage history with exactly one GET. Preview entry removed after build. This is not a user deployment URL, real SSO, PostgreSQL or provider acceptance.

## Main integration — 2026-11-19 05:30 KST

Merged main f78c174fabfb231ffdf6cf07130f513e0db047c7 into existing PR918; preserved canonical Account navigation and existing retry instead of creating duplicate recovery code. Operations/session/Account/history tests 67/67 pass, zero skipped, Node22.23.0. Full typecheck, lint (42 warnings, 181 infos), planning scan and diff checks pass. Browser recheck blocked: page tool timed out and visible Chromium showed Aw Snap error9; no new browser success claimed. Earlier native-browser evidence remains separate. Exact-head CI and new independent formal approval required. No installed URL, real SSO or paid provider acceptance.
