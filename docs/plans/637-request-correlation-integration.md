# Public usage request correlation integration (#637, #642)

1. Reuse only frontend 77d7b62 current-page correlation module and three-line usage mount wiring on #758. Keep frontend ownership and avoid unrelated ancestry.
2. Before production changes, reuse independent boundary tests and extend source/built public workspace acceptance over signed test SSO, real HTTP and migrated PGlite. Require meaningful RED for the missing panel.
3. Display exact principal/request groups from authorized current-page rows only. Retain attempts, unknown usage, possible billing and server duplicate markers; never infer retry order, complete history, deduplication or reconciled billing. No extra fetch or privilege expansion.
4. Verify self isolation, scoped principal denial without fallback, mandatory audits, navigation cleanup and fresh revocation. Run focused tests, typecheck, lint, docs and full check. Require exact-head CI plus valid independent approval and dependency gates before merge.
5. Native browser, real IdP/session, installed PostgreSQL, deployment and paid-provider acceptance remain separate and unclaimed. Roll back the module and bounded mount lines only.

## Evidence

- Ready-environment RED: 10 pass / 5 fail (source/built public panel plus three independent correlation cases), /tmp/og-1430-red-ready.log. Initial dependency setup error is not counted as behavioral RED.
- Initial GREEN: 15 pass / 0 fail / 0 skip, /tmp/og-1430-green.log; source/built signed testSSO real HTTP and migrated PGlite, two scoped attempts, other-principal isolation, existing 11 required usage audit outcomes per workspace.
- Frontend production module and independent tests are byte-identical to 77d7b62; usage-app wiring is three lines. Full checks, CI and independent formal review are separate gates.
- Ancestor #758 local standard check: 9233 pass / 1 worker SIGKILL failure / 1 real-PostgreSQL skip, not full PASS. CI all six success is independent evidence.

- Final focused GREEN: 80 pass / 0 fail / 0 skip, /tmp/og-1430-focused-corrected.log. Existing attempt tests adapted to the additional intentional correlation copies as in FE original: per-row evidence is scoped to the table, both copies clear on reload and denial. Intermediate broad run found those two stale count assertions (78 pass / 2 fail); no production defect was hidden.
- Typecheck PASS; full lint PASS with existing 42 warnings and 205 infos, no errors; planning/link/secret scan, six pinned compatibility checks and diff check PASS. Ancestor SIGKILL worker isolated rerun: 9 pass / 0 fail / 0 skip, /tmp/og-1430-dual-isolated.log; does not erase ancestor full-run failure.
