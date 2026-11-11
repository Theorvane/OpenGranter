# Reproducible management workspace build (#637)

1. Build the frontend-owned sso-catalog-entry, not the legacy catalog-only entry. No management source, authentication, API activation or public-source policy changes.
2. Return exact UTF-8 byte count, SHA-256 and fixed profile identity. Publish only complete bundles atomically to a new path; never overwrite files or symlinks. Receipt is not source provenance or deployment approval.
3. Prove RED for missing profile, GREEN for actual workspace build, deterministic digest and collision preservation. Exercise generated signed-out UI in a real browser; separate from private API/login/installed acceptance.
4. Stack on frontend #834. Reconcile dependencies and require exact-head CI and independent formal approval before merge. #860 has a different explicit-grant builder: do not merge divergent unreviewed usage services merely to change build tools.

5. Evidence: missing production module RED; actual bundle/digest/publication/CLI tests GREEN 3/3. TypeScript and planning checks pass. Combined 21-case regression reached 20 pass and one inherited npm-spawn test with null exit status (npm unavailable to that child); not reported as all-green. Browser reproduced Usage signed-out state and Audit-to-Account navigation defect; frontend owner notified. No management source edits.

Contract: [workspace build](../../contracts/management-workspace-build.md).
