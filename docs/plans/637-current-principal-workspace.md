# Current-principal workspace integration (#637 / #639)

1. Use only approved GET /management/v1/me. Account reads active-human identity, grants no IAM permissions and is not login/logout. No session/BFF/CSRF/CORS or runtime activation.
2. RED host acceptance: Account navigation, exact identity and teardown.
3. Bounded no-store transport and text-only Account view; loading, safe errors, abort/stale suppression on navigation, renewal, expiry, pagehide and disposal. No claims, bearer persistence or proxy fallback.
4. Source and built workspace acceptance with signed test SSO, actual loopback HTTP and migrated PGlite. Explicit catalog stubs. Removed/inactive binding and failed mandatory authentication audit.
5. Focused/full checks, PR, independent exact-head formal approval and CI gates. Installed PostgreSQL, native browser and real IdP remain separate.

## Follow-up: Account presentation at a suspended expiry boundary
1. Reproduce source and restricted-built workspace late response/body completions after the trusted absolute deadline, without firing expiry timers or navigating. Include invalid/throwing clocks and renewed-grant isolation.
2. Keep authority ownership in the existing host. Give Account an optional current-authority presentation guard; invoke it only after local lifecycle checks, at response/body continuations and before publishing identity. The host uses its existing clock/clear path so expiry clears shared read and mutation authority.
3. No authentication, API, SQL, session contract, public entry, timer policy or mutation semantics change. Coordinate the two existing frontend files, reuse existing fixtures, and avoid a new component.
4. Run RED before code, GREEN source/built plus existing Account/administration regressions, typecheck/lint/planning. Deliver on existing PR785 with superseding exact-head CI/review; no merge without both.

### Suspended-expiry execution (2026-11-08 KST)
- RED: all 16 source/built response/body boundary cases fail by presenting late-private-human (0 pass, 16 fail). GREEN: 18 new cases including renewed-grant isolation; 41 focused Account/workspace/real-HTTP/durable-audit tests pass, zero skipped.
- Native Chromium156 uses actual administration HTTP and dedicated Account audit (one successful audit). Holding an actual 200 response beyond trusted expiry with no timer callback clears identity and disables credential issuance; zero page errors or mutation requests. First native harness incorrectly expected the existing disabled Issue token button to be absent; corrected assertion to disabled. No production defect inferred from that harness assertion.
- Typecheck/lint/planning pass. New exact-head CI and independent formal approval remain required; prior all-green HEAD does not certify these changes.
