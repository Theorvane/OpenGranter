# Canonical Account transport (#639)

1. Preserve PR936 actual canonical identity endpoint and existing FE ownership. Add only an opt-in caller-authorized client; never authenticate sessions or persist credentials.
2. Write failing tests for exact identity projection, error states, bounded JSON, cancellation and stale responses. Exercise the client against actual Node HTTP and migrated embedded PostgreSQL.
3. Implement fixed /management/v1/principal GET, no-store/error redirects, 4096-byte fatal UTF-8 JSON decoding, 30-second deadline and explicit invalidation. Unknown identity fields fail closed.
4. Run bounded serial regression suites, full typecheck and changed-file lint; publish dependent draft PR and request exact-head review. No activation, DDL, deployment, live SSO or model calls.

## Reviewed main integration (2026-11-18)
5. Integrate reviewed main 03aa48f after parent PR936 merge, retaining its canonical identity tests, owned HTTP public assets, operations/CSP and disconnect safeguards.
6. Extend the actual HTTP client regression with anonymous denial and restored-binding reauthentication after revocation. Verify each read crosses fresh identity and mandatory audit; no session acquisition, deployment or schema installation is introduced.
