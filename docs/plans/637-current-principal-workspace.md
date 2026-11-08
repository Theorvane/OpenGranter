# Current-principal workspace integration (#637 / #639)

1. Use only approved GET /management/v1/me. Account reads active-human identity, grants no IAM permissions and is not login/logout. No session/BFF/CSRF/CORS or runtime activation.
2. RED host acceptance: Account navigation, exact identity and teardown.
3. Bounded no-store transport and text-only Account view; loading, safe errors, abort/stale suppression on navigation, renewal, expiry, pagehide and disposal. No claims, bearer persistence or proxy fallback.
4. Source and built workspace acceptance with signed test SSO, actual loopback HTTP and migrated PGlite. Explicit catalog stubs. Removed/inactive binding and failed mandatory authentication audit.
5. Focused/full checks, PR, independent exact-head formal approval and CI gates. Installed PostgreSQL, native browser and real IdP remain separate.
