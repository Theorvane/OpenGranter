# Delegated session identifier plan

## Issue and problem

- Issue #452; release gate #116 stays open.
- Official OpenRouter ChatRequest exposes optional non-null session_id:string with maxLength256 and body-over-x-session-id precedence. The gateway rejects that body field and ignores the header. The Node bridge currently drops empty headers.

## Scope and expected behavior

- Capture an exact selected identifier before route/credential awaits, forwarding only delegated session_id in both chat bases and nonstream/text/refusal/function streams. A present body field takes precedence, even when empty or invalid; reject invalid body instead of rescuing it from a header. Missing body uses the platform-parsed x-session-id header, including empty values. Omission injects no default.
- Validate primitive non-null strings of at most 256 Unicode code points, preserving case/Unicode/whitespace/empty text. Header parsing already normalizes HTTP whitespace and duplicate values; no claim about raw bytes. Preserve empty headers in the Node bridge.
- Native OpenAI/Anthropic/Gemini identifiers reject before secrets without substituting user/cache key/metadata. Do not create gateway conversation state, sticky routes, cache claims, trace/broadcast integration, model overrides or principal identifiers.
- Fixed approved model/provider.only destinations and final-provider checks, auth/IAM/Deny/limits, private operational audit projection, required audit/usage, missing usage and possibly-billed failure/cancellation remain unchanged.

## Design

- Add a shared bounded string snapshot at HTTP/public adapter boundaries. HTTP chooses body/header; delegated body retains exact field. Native adapters reject supplied values before key lookup. Wire no generic caller headers upstream.
- Count Unicode code points per JSON Schema maxLength rather than UTF16 units; no minLength/pattern/default is invented. Parsed headers become body values under the documented equivalence.
- Alternative forwarding arbitrary headers changes the trusted boundary; treating session preferences as identity or local route state changes product semantics. Keep this reversible wire mapping; glossary/ADR changes are unnecessary.
- Dependencies: official OpenRouter schema/caching docs and JSON Schema Unicode-length rules. Full native/client/provider behavior, #116 and unresolved #7 remain open.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/session-identifiers.md). Expand source pin to version 29/33 fields, retaining all selected definitions; removing session_id must reproduce version 28 canonically.

## TDD plan

- First public tests expect body/header forwarding and correct precedence; old body requests return400 and header-only requests omit the upstream field. Actual SDK sockets expose the empty-header bridge loss.
- Cover empty/max256/overlong257, astral/combining Unicode, null/nonstring/boxed values, absence/no default, header fallback/invalid selected header/ignored invalid header, own getters read once, throwing getters and credential-time mutation, independent user/key/metadata/cache/tool history controls.
- Exercise both bases/modes/streams and actual installed SDK sockets; auth/implicit/model/provider Deny, limits, selection/audit/usage failures, missing usage, opened errors and cancellation. Native unsupported fields reject pre-secret. Request body bounds remain shared.
- Structural tests cover raw non-null string maxLength, absent minimum/default, annotation invariance and type/required/bound/default drift; stale versions and rehashed missing/extra/malformed map guards. Capture fresh canonical provenance and removal equality.
- Smallest implementation: shared snapshot, HTTP selection/allowlist, delegated capture/body, native rejection, empty header preservation and exact source selection/version. Format, focused/full npm run check and fresh compatibility:drift.

## Delivery

- Issue/new branch/plan, meaningful red tests, minimal implementation, all checks, exact published diff review, both required CI jobs, sjungwon03-ai approval and sjungwon03 squash merge.
- Risk: upstream sessions may affect sticky routing/observability, but gateway destinations remain explicitly bounded; forwarding cannot certify cache hits, stickiness, retention, savings or billed cost. Header normalization is transport behavior. Roll back bounded admission without migrations.
- PR records red/green/socket counts, source digests/removal equality, full checks and material remaining #116/#7 gaps.

## Verification evidence

The gateway now accepts bounded delegated session identifiers in either the request body or the parsed x-session-id header on both chat bases and all supported response modes. A present body field wins, including empty strings; invalid selected values reject before route resolution. Empty headers survive the Node bridge. Unicode limits count code points, and identifiers remain independent of authorization, accounting, attribution, cache keys and metadata. Native adapters reject unsupported identifiers before credential lookup.

Red evidence: public runtime tests initially produced 47 expected failures and one pass; the initial SDK socket suite produced 61 expected failures, including the isolated empty-header bridge regression. Initial session schema tests produced ten expected failures and one existing annotation-invariance pass. Green evidence: 48 runtime tests, 69 SDK/socket tests (136 actual SDK requests plus the bridge probe), and 306 focused runtime/schema tests pass. Coverage includes authentication and model/provider Deny, limits, required audit/usage failures, missing usage, mutation/getter safety, Unicode/oversized rejection, opened failures and cancellation.

Version 29 selects 33 fields and retains the same 22 request-history definitions. Only session_id is added; canonical removal matches the previous version-28 projection SHA-256 58e9a0a83abf7e1863d552979158684fe72dec43df1318e8d8ddcb7a81ef22b7. Fresh source SHA-256: 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458. New projection SHA-256: b7c53ad02fc7fd222e659c3ea6ae76367f39c985a3cf4c063875c686629da71f. Fresh compatibility:drift passes.

Material limits: socket coverage uses installed OpenAI 7.23.0 and OpenRouter 1.4.18 with a captured mock upstream; it does not certify live provider stickiness, retention, cache hits, savings or billed cost. Header exactness follows platform HTTP normalization. Native equivalents and trace/broadcast integration are excluded; release gate #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 4914 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
