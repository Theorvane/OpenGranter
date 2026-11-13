# Canonical audit event inspection

## Issue and problem
- Issue: #642, parent #637.
- Canonical history currently displays only timestamp, kind, principal and request; operators cannot inspect the already-authorized failure metadata.

## Scope and expected behavior
- Add a native disclosure with event ID and an explicit allowlist of existing scalar metadata: model, route version, candidate/attempt, recorded target, outcome, failure category, denial reason, possibly billed, completion, count, target principal and read mode.
- Missing values show Unknown; zero and false remain distinct. Never enumerate raw details or show credentials, policy versions, prompt/response, arrays or nested selection decisions.
- No new network calls, authority, public entry activation, retention, mutation, schema or provider calls. Existing signed-in caller port, mandatory server audit and row lifecycle remain authoritative.

## Design
- New audit-record-details renderer called only for the canonical audit row. Native details/summary and text-only definition lists follow existing usage disclosure pattern.
- Raw JSON was rejected because metadata presence does not justify wholesale display. Arrays/nested objects deliberately remain unrendered.
- Existing session/deployment approvals remain unresolved and untouched; no new product decision required.
- Update PRD, architecture, acceptance and management-history-workspace contract.

## TDD plan
- First add public mount tests: expect Inspect audit event and failure/count fields; fail because current rows have no disclosure.
- Cover zero/false/Unknown, redaction, event variants, loading clearing, malformed response, sibling denial and disposal, plus actual loopback HTTP transport.
- Implement minimal text-only allowlist renderer, then run targeted history/operations tests, strict typecheck, lint, planning, compatibility and npm run check.

## Delivery
1. Record plan and RED tests before production change.
2. Implement renderer and canonical invocation; verify GREEN and lifecycle isolation.
3. Publish issue-numbered PR, request independent exact-head review, wait for all required CI and formal approval before merge.
- Rollback: remove renderer invocation; no stored-state change.
- Evidence is local/fixture unless explicitly identified as installed IdP/PostgreSQL/provider validation.

## Verification (2026-11-13)
- RED: new public mount suite 1 passed / 5 failed, all failures missing audit disclosure; malformed response already failed closed. Log: /tmp/og2200-red.log.
- GREEN: 7/7 including actual loopback HTTP, signed fixture JWT, all SQL migrations into PGlite, foreign-principal isolation, fresh IAM denial, durable ready/forbidden access audit. Log: /tmp/og2200-http.log.
- Targeted canonical history/audit/operations: 108/108 passed, zero skipped. Strict full TypeScript passed; full Biome exited zero with existing warnings/info. Planning/links/secret fixture scan and all six compatibility pins passed.
- Native Chromium canonical artifact preview http://127.0.0.1:18816: Audit tab, mouse expand, exact bigint event ID, failure/timeout and Unknown fields, Space collapse. Synthetic data only, not a user deployment URL. Temporary preview entry removed.
- npm run check blocked before repository scripts: bundled npm executable permission and explicit npm CLI missing module. Separate direct checks above do not establish full-check success. No real company IdP, installed PostgreSQL or provider/paid call acceptance.
