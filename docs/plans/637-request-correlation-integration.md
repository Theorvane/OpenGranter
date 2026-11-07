# Public usage request correlation integration (#637, #642)

1. Reuse only frontend 77d7b62 current-page correlation module and three-line usage mount wiring on #758. Keep frontend ownership and avoid unrelated ancestry.
2. Before production changes, reuse independent boundary tests and extend source/built public workspace acceptance over signed test SSO, real HTTP and migrated PGlite. Require meaningful RED for the missing panel.
3. Display exact principal/request groups from authorized current-page rows only. Retain attempts, unknown usage, possible billing and server duplicate markers; never infer retry order, complete history, deduplication or reconciled billing. No extra fetch or privilege expansion.
4. Verify self isolation, scoped principal denial without fallback, mandatory audits, navigation cleanup and fresh revocation. Run focused tests, typecheck, lint, docs and full check. Require exact-head CI plus valid independent approval and dependency gates before merge.
5. Native browser, real IdP/session, installed PostgreSQL, deployment and paid-provider acceptance remain separate and unclaimed. Roll back the module and bounded mount lines only.
