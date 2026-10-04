# Referenced chat message history schema drift

## Issue and problem

- Issue: #308; release gate #116 remains open.
- Version 16 tracks the messages parent reference and assistant/tool definitions,
  but unchanged references hide message-union and instruction/user content drift.

## Scope and expected behavior

- Add exactly ChatMessages, ChatSystemMessage, ChatDeveloperMessage and
  ChatUserMessage to the existing definition map; bump reviewed pin to version 17.
- Track full structural union/discriminator/role/content/required/default shapes,
  constraints and literal configuration references. Ignore editorial annotations.
- Retain all previous selections, including whole assistant/tool schemas.
- Reject missing/malformed sources and rehashed missing/extra/malformed exact maps;
  versions 1..16 reject. Source fetching stays bounded, fixed-host and credential-free.
- No runtime, provider, IAM, secrets, audit or usage change. Selected rich-content
  and configuration references do not enable those capabilities or certify instances.

## Design

- Extend the existing explicit definition allowlist and strict version gate.
- Explicitly fetch official source, compare all prior projections before updating
  provenance/hash and record any actual source changes instead of hiding drift.
- Independent official-shaped fixture constants cover the new definitions; prior
  name-only ignored-content test becomes a whole-message drift test.
- Update source contract, architecture/acceptance and compatibility checkpoint;
  PRD runtime scope and glossary remain unchanged. No costly decision/ADR needed.
- Recursive rich/configuration references and complete external-client certification
  remain unresolved under #116.

## TDD plan

- New exact selection, unchanged-parent union/content/role/required drift and
  older-version tests must fail before implementation.
- Verify annotation omission, literal annotation-named data preservation, malformed
  sources/maps, and ignored unselected rich/configuration changes.
- Add four allowlist entries and version 17; refresh reviewed pin, run focused
  drift tests, npm run check and explicit compatibility:drift.

## Delivery

- Issue/plan, tests/red, minimal projector/pin/green, checks, exact-head review/CI,
  authorized sjungwon03 merge and main synchronization.
- Risk: accidental source acceptance; compare every previous selection and source
  digest before refresh. Roll back projector and matching pin together.
- Publish evidence/digests and remaining gates in PR; no complete compatibility claim.

## Source review and verification evidence

- Initial red: 97 passed, 7 expected failures (missing selections/undetected drift,
  old-version acceptance). Focused green: 104 passed.
- Every prior selection matches exactly. Source digest changed from
  f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e to
  b818343bf2417ad8abdef9ceeea45140db6e06670d7fa54356591cd3304dd3f5.
- Reviewed unselected differences: Models API v2 paths and 26 new definitions,
  Responses/default/provider-metadata nullability, audio provider fields,
  parameter nullability and SDK-name overrides, and tags. New selected history
  definitions retain the independently recorded official structural fixtures.
- Projection hash:
  4f1702e90cb64cabcd243990240bde731276eed2e9f725a3d8e30eb4e364955d.
- Full check/live comparison and exact-head review/CI results are reported in PR.
- Final npm run check: 1424 passed, one existing optional PostgreSQL integration
  skip; strict typecheck, lint, planning/links/contracts/secret scan and offline
  pin integrity passed. Explicit compatibility:drift passed against official source.
