# Audit page CSV export

## Issue and problem

- Issue: #65
- Audit reviewers have scoped JSON pages but need downloadable metadata. Usage CSV already defines bounded-page and encoding behavior.

## Scope and expected behavior

- GET /v1/audit accepts format=json (default) or format=csv; unknown/repeated values return 400.
- Preserve audit:Read on the target principal, occurrence-time bounds, event-ID order/cursor, at most 100 events, full-page validation, and required read auditing.
- Export event ID, occurrence time, kind, request/principal/credential IDs, policy versions, and sanitized details. No retained content, raw tokens, keys, or unexpected fields.
- Return a fixed audit filename, UTF-8 CSV, no-store, request ID, X-Has-More, and optional X-Next-Cursor. Empty pages contain headers only; failures remain safe JSON errors.
- One page per download; full-history jobs and tamper-resistant external export remain separate.

## Design

- Extract the existing CSV cell/row encoder into a shared module while preserving usage output.
- Audit serializer calls the existing page projection with explicit target and query context before exporting allowlisted columns; JSON fields contain sanitized details and policy versions only.
- Serialize within the existing unavailable-read boundary before required success audit; no partial CSV escapes.
- Keep usage's quoting, CRLF, and documented apostrophe transformation for formula-looking text. JSON remains exact machine-readable output; spreadsheet roundtrip behavior is not universally guaranteed.
- Update PRD, architecture, acceptance, and gateway scenarios.

## TDD plan

- New HTTP CSV success fails with existing 400; new serializer import fails because the module is absent.
- Test filtered success and continuation, denied/malformed requests, unavailable/mixed-principal/out-of-range storage, required audit failure, empty pages, projection, event-ID order, and invalid inputs.
- Retain usage serializer regression tests to verify the shared encoder refactor.
- Run npm run check and report red/green evidence.

## Delivery

- Additive format option, no new schema, permission, or deployment setting.
- Describe bounded downloads and JSON details columns in the PR. A database CSV is not a tamper-resistant archive.
