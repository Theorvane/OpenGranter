# SSO public browser entry (#639)

1. Compose the existing SSO page lifecycle with the public root, preserving the frontend entry and session/runtime holds.
2. Build the real bundle and execute it with structural DOM/event ports. Record missing-entry RED before implementation.
3. Verify sign-in-only startup, absent-root safety, pagehide/pageshow and no fetch, storage or global grant API.
4. Run focused tests, typecheck, lint and required CI; obtain exact-head formal review before merge.
5. Serve the bundle with the existing HTTP server. HTTP/VM evidence is not actual browser login acceptance; no company IdP or production activation.

## Local evidence (2026-11-05)

- RED: actual build rejected missing sso-catalog-entry.ts (ENOENT), 1 failed test. Node 18 invocation was a toolchain failure and is not RED evidence.
- GREEN: Node 22 focused SSO client/session/authority/DOM/page/entry, response encoding and real signed-JWT HTTP integration: 30 passed, zero skipped. Typecheck and planning checks passed.
- Public HTTP shell on localhost:18740/management: 200, no-store, restrictive CSP. Application handler remains 404. Structural DOM/VM execution is not actual browser or company IdP acceptance.
- Both browser and desktop tools report screen still being released. Session/BFF, CSRF and IdP decisions remain blocked; no runtime activation or paid calls.
