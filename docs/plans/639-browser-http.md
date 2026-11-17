# Browser HTTP entry (#639)

## 1. Scope
Serve a public, data-free management shell at /management and /management/ and an explicitly supplied trusted build artifact at /management/app.js. Do not read disk paths, embed credentials, create sessions, infer catalog rights, or bridge human identity to proxy authority. Frontend owns DOM and build artifacts; backend owns authenticated API/session contracts. The host explicitly supplies the existing application handler for non-static paths, preserving authentication and authorization. Opt-in only: no production runtime or ingress activation.

## 2. Acceptance
GET and HEAD only on exact static routes. Reject queries, body framing and unsupported methods before serving static content. HEAD has no body. Fixed CSP forbids inline/eval scripts, cross-origin connections, framing, forms, objects and base URL changes. All static responses including errors are no-store and nosniff. Shell contains no private state. Never turn an API error into an HTML fallback: delegate requests unchanged and preserve responses. Artifact is trusted public build input, not user HTML or a credential container.

## 3. Verification and rollback
Missing-module RED, then real localhost HTTP tests for document/module delivery, HEAD, headers, unsupported methods/framing and API authentication/denial delegation. TypeScript, Biome, scripts and exact-head full CI plus independent formal approval before merge. Static-shell evidence is not browser SSO, catalog authorization, installed validation or provider E2E. Rollback removes the isolated optional module; shared Node adapter unchanged.

## 4. Local evidence
Node22.23.4 ARM64 missing-module RED at /tmp/og-1130-browser-red.log. Browser HTTP and existing catalog authority/session/client/socket suite: 32 pass, 0 fail, 0 skip at /tmp/og-1130-browser-suite.log. Full TypeScript passed; Biome no errors with existing 42 warnings/145 infos; scripts/check.py and diff check passed. Actual Chromium opened http://127.0.0.1:18939/management with the existing boundary-view module stripped to JavaScript; DOM showed Sign-in required and company identity service guidance. This is public boundary rendering only. The smoke listener has no configured authentication/catalog/provider and returns 401 for nonstatic paths. No browser SSO, authorized catalog, installed or provider certification.
