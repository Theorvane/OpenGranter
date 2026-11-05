# Usage to current model inspection (#642)

1. Connect the existing usage rows to the existing catalog detail view within the trusted workspace; add no screen, endpoint, credential source, session or runtime activation.
2. Treat a historical model alias only as a lookup key. Dispose usage state/downloads, obtain current detail through the existing fresh SSO/IAM audited GET and never use historical usage as permission or route authority.
3. Guard detached controls, expiry, pagehide and renewed grants. Preserve list navigation and fail-closed hidden/not-found and denied states.
4. Establish RED/GREEN UI and signed loopback HTTP/SQL acceptance, run typecheck/lint/planning/full checks and request exact-head independent review. Do not merge without all required CI and formal approval; native browser and installed IdP remain unverified.
