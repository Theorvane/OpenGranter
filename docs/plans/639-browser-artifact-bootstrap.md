# 639: Explicit prebuilt browser artifact bootstrap

1. Scope: close the file-to-owned-runtime integration gap for #639/#643. A trusted caller explicitly selects a reviewed public JavaScript artifact and supplies existing SSO/runtime configuration. No CLI autoactivation, authentication bridge, session, permissions or deployment approval.
2. Contract: require an absolute artifact path and an ordinary nonempty UTF-8 file, at most 8 MiB. Reject NUL, malformed UTF-8, directories and oversized files before database acquisition or listener creation. Read in bounded chunks even if a file grows. Trusted symlinks are resolved normally; this is not a sandbox, signature verifier or secret scanner. Operators own provenance and atomic publication.
3. RED: valid prebuilt artifact serves over the real owned HTTP listener and shuts down cleanly. Invalid/missing artifacts fail with one sanitized error and zero connection acquisitions. Existing runtime remains default-off unless this separate helper is explicitly called.
4. GREEN: execute artifact/bootstrap, SSO runtime and browser boundary suites with embedded migrated SQL and generated fixture SSO keys. Run typecheck, lint, planning/link and whitespace checks. These are local tests, not installed SSO/provider acceptance.
5. Integration: build the reviewed browser entry separately via management:build, publish the artifact, then call startPostgresSsoBrowserGateway with browserArtifactPath plus existing trusted runtime ports. No runtime esbuild dependency or request-selected filesystem path. Returned address exposes /management; authentication and catalog integration remain separate.
6. Release: exact-HEAD full CI and independent formal approval before merge. Do not claim a stable user URL, authenticated DOM flow, installed target or live-provider result from this helper.

## Execution evidence (2026-11-04)

- RED: new acceptance suite failed on the missing bootstrap implementation (0 pass / 1 file failure), /tmp/og-1300-red.log.
- GREEN: 21/21 tests passed, no skips, including real loopback HTTP, generated fixture SSO authentication denial, embedded PostgreSQL migrations, regular-file symlink loading, malformed/empty/whitespace/NUL/oversize/missing/directory/relative artifact rejection, existing SSO lifecycle and browser/build boundaries (/tmp/og-1300-final-suite.log).
- Initial inherited node_modules lacked esbuild; replaced only this worktree symlink with an isolated npm ci --ignore-scripts (40 packages, zero reported vulnerabilities). Final full typecheck passed (/tmp/og-1300-tsc-final.log); full Biome passed with 42 existing warnings and 148 infos (/tmp/og-1300-lint.log). Planning/link checks and whitespace checks passed.
- These are local library/bootstrap tests, not DOM login/session, deployed PostgreSQL, installed SSO or provider acceptance.

## Trusted bootstrap example

Build and publish a reviewed src/management entry with npm run management:build -- src/management/<reviewed-entry>.ts. Do not serve unreviewed output. In the already approved SSO bootstrap, call startPostgresSsoBrowserGateway({ ...trustedSsoRuntimePorts, browserArtifactPath: absolutePublishedArtifactPath }); retain the returned runtime and await runtime.close() on shutdown. The existing runtime owns database/listener cleanup. Return address is not proof of externally reachable ingress. Invalid artifact paths never acquire the database. No command or environment variable automatically enables this helper.
