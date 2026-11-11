# Opt-in management usage/audit listener

1. Preserve the existing signed-bearer boundary, default dispatch and browser shell. No session/CSRF decision or deployment approval.
2. Add explicit trusted enableHistoryReads boolean (default false); reject non-booleans before database open.
3. Mount exact /management/v1/usage and /management/v1/audit paths using concrete durable compositions only when enabled. Reuse migration, connection and listener lifecycle. No audit callback override.
4. RED missing HTTP route; GREEN local Node HTTP plus migrated PGlite and signed JWT: JSON/CSV, empty, cross-principal Deny, invalid query, missing authentication, fresh inactive principal, failed audit insert. Defaults remain404.
5. Run runtime regressions, typecheck/lint/scripts and CI; exact-head formal independent approval before merge. This is not native browser/login, installed PostgreSQL or provider acceptance.

## Evidence

Baseline runtime reproduced404 instead of200 (1 pass/1 fail); restored implementation passes14/14 history/catalog/token/browser runtime cases, zero skips. Full TypeScript, targeted Biome, scripts and diff checks pass. Earlier parallel fullcheck on parent863 hit SIGKILL/resource pressure and was stopped; no full local suite success claimed.
