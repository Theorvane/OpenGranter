# 639: Pin the reviewed management browser artifact

1. Scope: optional trusted SHA-256 verification in the explicit artifact bootstrap for #639/#643. No server composition, session, schema, grants, activation or deployment changes.
2. Contract: browserArtifactSha256, if supplied, is exactly 64 lowercase hexadecimal characters. Hash actual bounded raw bytes from the opened descriptor; malformed or mismatched pins fail with the existing sanitized error before SQL acquisition. Omitted pins retain existing behavior.
3. RED: substituted bytes and malformed pins reject before SQL; a matching pin and existing unpinned bootstrap serve exact artifact bytes over owned HTTP.
4. GREEN: implement verification without reopening the file or trusting metadata; run bootstrap/runtime/build tests, full typecheck/lint and planning checks.
5. Operations: take the digest from a trusted release record. Computing it from an untrusted file is not a substitute for review. A match proves byte identity only, not authenticity, JavaScript semantics or secret safety.
6. Release: exact-HEAD mandatory CI and formal independent approval before merge. Local SQL/fixture SSO/loopback HTTP do not establish installed or browser-session acceptance.

## Local execution evidence (2026-11-08 17:00 KST run)

- RED: the new substitution test reached SQL without validation and returned GatewayStartupUnavailable instead of the artifact error (3 pass / 1 fail), /tmp/og-1700-red.log.
- GREEN: bootstrap, build and owned gateway runtime suites 35/35 passed, zero skips, /tmp/og-1700-green.log. Published consolidated entry is served through real loopback HTTP with a matching digest; legacy entry remains unpinned. Mismatch, malformed pins and same-length substitutions fail before SQL.
- Full typecheck and lint passed (42 preexisting warnings, 304 infos); planning/link and whitespace checks passed. This is local embedded SQL/generated SSO evidence, not company SSO, native browser, installed PostgreSQL or provider acceptance.
