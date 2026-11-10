# Management HTTP privacy boundary (#639)

## Issue and problem

The shared Node bridge enforces no-store for model discovery, but not for the reserved management namespace. A management handler exception reaches a generic fallback without cache protection. A custom handler can also accidentally return cacheable principal-specific data or one-time credentials.

## Scope and design

1. Reserve exact /management and slash descendants for transport-level no-store and nosniff, on success, denial, missing route and fallback errors, independent of HTTP method. Do not match /management-public or unrelated paths. Classify the normalized pathname already used by the bridge, never a query parameter.
2. Apply headers after the child response headers on normal and fallback branches. Preserve status, body, request ID, WWW-Authenticate and existing discovery cache protection. No route mounting, session, login, CSRF, authority, schema, durable audit or provider behavior changes.
3. Start with real loopback HTTP tests reproducing missing privacy headers on success and unexpected fallback. Cover custom fallback with unsafe headers, denial, POST issuance-like responses and namespace boundaries. Tests use synthetic data, not authentication or real issuance.
4. Implement the smallest shared transport guard. Run targeted socket regressions, typecheck, lint, planning and compatibility checks. Full required CI and independent formal approval precede merge.
5. Deliver an independent PR to main, not another credential-reader stack. Rollback reverts the header guard only. This does not prevent browser history, BFCache or application memory retention, nor certify installed ingress behavior. Login/session contracts remain unresolved and no installed UI URL is claimed.

## Contract and verification

See [contract](../../contracts/management-http-privacy.md). Actual loopback Node transport tests are not company SSO, native-browser or installed deployment acceptance. No new permissions are implied.

## Execution evidence

- Real loopback regression before implementation: 12 tests, 10 expected privacy-header failures and 2 unrelated-path passes (/tmp/og-0700-red.log). No loader/dependency failure was counted as RED.
- After implementation: focused 12 PASS, 0 FAIL, 0 SKIP (/tmp/og-0700-focused.log). Broader socket/catalog regression 34 PASS, 0 FAIL, 0 SKIP includes these 12 (/tmp/og-0700-regression.log).
- Full typecheck, lint, planning and offline compatibility checks exited 0 (/tmp/og-0700-exits.json); existing lint retains 42 warnings and 148 infos. Diff whitespace check passed.
- Resource-heavy full local suite was not duplicated; required CI must validate the exact submitted HEAD before merge. No installed/browser/company-IdP, live-provider or paid acceptance. No standing URL: loopback servers close after tests.
