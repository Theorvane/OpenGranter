# SSO browser process entry (#639, #643)

1. Close the executable-to-owned-browser-runtime gap without session activation or new authority.
2. Reuse configuration, migration-gated browser bootstrap and process shutdown primitives. Preserve proxy CLI behavior; require dedicated createSsoBrowserPorts factory.
3. Demonstrate missing entry RED before implementation; validate wrong factory, missing ports, safe diagnostics, owned fields and lifecycle cleanup.
4. Exercise real loopback HTTP with migrated PGlite, signed test JWT, catalog authentication and binding revocation. No company IdP or installed PostgreSQL claim.
5. Run focused regression, typecheck, lint and planning checks; exact-head CI plus formal independent approval before merge. No deployment, paid calls or automatic activation.
