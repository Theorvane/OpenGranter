# SSO catalog HTTP boundary (#637, #641)

1. Preserve original PRD SSO-human discovery and existing InvokeModel/UseProvider visibility; do not add administration permissions or proxy credentials.
2. Own only new HTTP adapter/test/contract/plan files. Backend owns BFF sessions, OIDC, durable SSO audit and runtime; frontend owns DOM. Expose explicit GET /management/v1/models and encoded exact-alias detail to trusted server callers.
3. Establish RED for missing factory, then implement strict path/method/query checks, server correlation IDs, bearer extraction delegated to the fresh audited service, safe response mappings and no-store on every outcome. No cookie authentication/CORS/listening activation.
4. Test Fetch and real loopback Node sockets, service outcomes, empty/list/detail, encoded aliases, anonymous failures, invalid requests, hidden detail, failures, cancellation and private-data suppression. Distinguish local acceptance from installed IdP/PostgreSQL/browser evidence.
5. Run related tests, full typecheck/lint and planning checks; commit as verified sjungwon03, open PR and obtain exact-head formal independent approval and all required CI before merge.

No production activation, paid inference, atomic revocation or full-product completion is implied.
