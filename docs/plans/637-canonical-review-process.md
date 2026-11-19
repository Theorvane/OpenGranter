# Canonical review process (#637, #643)

1. Add a separate opt-in executable around the approved pinned-artifact canonical bootstrap; preserve every existing launcher.
2. Require a distinct trusted createCanonicalReviewPorts factory, absolute artifact path, and lowercase SHA-256 before start. Reuse process config, real clock, request IDs, bounded shutdown and signal cleanup.
3. Prove invalid and legacy factories never start. Prove real loopback canonical APIs and public shell use the same owned migrated SQL connection and close on signals. Record meaningful legacy-runtime substitution RED then restored GREEN.
4. Run regression, TypeScript, lint and repository contracts. Require exact-head CI and independent formal review before merge.

No session acquisition, cookie/CSRF/CORS/IdP decision, default activation, provider invocation, provisioning or deployment approval. A public shell is not an authenticated browser.
