# Legacy reasoning inclusion aliases

## Issue and problem

- Issue: #322. Documented include_reasoning boolean requests reject at HTTP and
  are ignored by standalone adapters. Official guide maps true to reasoning {}
  and false to reasoning {exclude:true}; OpenAPI/SDK omit and strip the flag.

## Scope and expected behavior

- Normalize delegated true/false aliases into the documented immutable configuration
  on both chat bases, nonstream and existing ordinary text streams. Remove the
  legacy field upstream; preserve omission and independent named shorthand effort.
- Reject null/malformed aliases and simultaneous supplied reasoning configuration
  before routing/credentials. Mixed-field precedence is undocumented; restriction
  is local subset policy, not an asserted upstream prohibition.
- Undefined optional alias remains omission. No effort/defaults are injected.
- All direct providers reject supplied aliases before credentials, including false.
- Preserve auth, complete model/provider IAM/Deny, limits, required audit/usage,
  persistence-gated streams, privacy and safe possible-billing failures. No local
  response filtering, reasoning fabrication or reduced/free usage inference.

## Design

- Shared projection accepts the already-captured optional legacy value, validates
  booleans/exclusive raw configuration, and returns a frozen normalized object.
- HTTP allowlist and typed adapter interface admit the flag; validated HTTP output
  contains only normalized configuration. Delegated adapters normalize raw typed
  requests too. Native guard rejects aliases within its sanitized exception boundary.
- Keep independent shorthand and current effort/control rules unchanged; generated
  configuration contains no nested effort. Native aliases are not silently ignored.
- Exact raw flag forwarding is an alternative; use documented normalization to keep
  one enforceable configuration path, without invented precedence or SDK certification.
- Pin v18 unchanged; no source field is fabricated. No domain term or costly ADR.
- Update PRD, architecture, acceptance, compatibility and related contracts.

## TDD plan

- Public alias HTTP normalization and adapter forwarding first fail or are ignored.
  Test true/false/omission, both bases/modes and independent named/null shorthand.
- Add invalid/mixed values, single getters/late mutation/safe accessor failures,
  direct pre-secret rejection, complete history coexistence, auth/explicit/model/
  provider Deny, limits, required persistence, privacy and failed billing.
- Actual compatible SDK sends raw aliases and gateway normalizes; pinned OpenRouter
  SDK sockets demonstrate stripping. Returned reasoning/usage stay unchanged.
- Minimal shared snapshot/HTTP/provider guards, format/type/focused/full checks.

## Delivery

- Issue/plan, meaningful red, minimum green, docs/full check, exact-head approval as
  sjungwon03-ai, required CI, authorized sjungwon03 merge and clean main sync.
- Risks: SDK/source omission and mixed-field semantics; rollback removes optional
  aliases without changing core controls. Native/tool streams and #116 stay open.
- Report red/green, full-check evidence, existing skip and remaining scope limits.

## Source and verification evidence

- Fresh guide/OpenAPI/installed SDK inspection confirms documented equivalents,
  source omission and SDK stripping; mixed-field/null precedence remains unresolved.
- Initial public red: all 7 tests fail as expected before HTTP/adapter normalization
  and native pre-secret handling. Prior shorthand legacy rejection now tests null.
- Final focused reasoning/history green: 73 passed, including normalized aliases,
  native guards, SDK behavior, getters/mutation and IAM/persistence/billing paths.
- Full npm run check passed type checking, linting, 1,475 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. The final
  evidence-only plan update also passes the planning checker.
