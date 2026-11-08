# 795: Reviewed browser artifact publication

1. Scope: prepare the existing reviewed public management entry for the opt-in artifact loader (#637/#643). No UI, authority, session, ingress, Docker or listener changes.
2. Contract: retain stdout-only CLI. Explicit --output <path> after the reviewed entry publishes exactly the built UTF-8 module, never npm logs. Resolve against the caller working directory. The parent directory must already exist and be trusted by the operator.
3. Safety: build fully in memory first. Stage a private file in a private temporary directory beside the destination, then atomically hard-link it into place without replacement. Existing files, directories and symlinks remain untouched. Remove staging artifacts on success or failure. No environment injection, HTTP-selected paths, session grants or secrets.
4. RED/GREEN: exercise the real CLI through npm without --silent, load the published ESM, preserve existing artifact and symlink targets, reject malformed arguments, verify build/missing-parent failures leave no artifact or staging leftovers. Keep existing build tests.
5. Integration: npm run management:build -- src/management/catalog-entry.ts --output /absolute/trusted/path/app.js . Use a new versioned filename each publication; rollback selects the previous reviewed artifact through the existing trusted host. The entry remains locked. Built modules are not browser/SSO/installed/provider acceptance.
6. Gates: focused tests, typecheck, lint, plan checks, exact-head required CI and independent formal approval before merge. No production or paid calls.

## Evidence

RED: real npm CLI publication case failed (7 pass, 1 fail), before implementation; /tmp/og-1530-red.log. GREEN: 14/14 build, HTTP and owned-bootstrap tests pass with zero skips; /tmp/og-1530-integration.log. The bootstrap test builds the actual catalog-entry.ts via the CLI, loads the published file into the owned migrated PGlite-backed runtime, and reads identical JavaScript over a real local HTTP socket. This is local embedded-database acceptance, not installed PostgreSQL or native-browser SSO. Initial unbounded typecheck was killed by the local resource limit; a separate 1024 MiB bounded typecheck passes. Full lint passes with existing warnings/informational diagnostics; planning/link checks and whitespace checks pass. Exact-head CI and formal review remain pending.
