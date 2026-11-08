# Credential request content coding (#766)

## Issue and problem
Refs #766, #637 and #640. The credential HTTP boundary accepts valid JSON bytes labelled with an unsupported Content-Encoding and can issue/revoke credentials. It implements no decompressor. This is a representation-validation defect, not a new authorization policy.

## Scope and expected behavior
After successful human authentication, accept absent Content-Encoding or a single case-insensitive identity coding with optional surrounding whitespace. Reject other, empty or chained values with fixed 400 invalid_request/no-store before body access or service dispatch. Preserve existing JSON/UTF-8/byte limits, current IAM, mandatory audit and success responses. No decompression, session/BFF, database, permission, runtime activation or provider calls.

## Design
Check the existing request header before acquiring a body reader. Avoid decompression and its expanded-size semantics: no compressed upload capability exists in this API. Do not inspect body/media/coding before authentication; retain anonymous authentication audit failure precedence. No new domain terms or irreversible design decision. Contracts: contracts/sso-management-http.md; acceptance: docs/acceptance.md. Existing PRD/architecture and unsettled session decisions remain unchanged.

## TDD plan
For both public Fetch operations, valid JSON labelled gzip/br/deflate/zstd, empty, unknown or stacked codings must reject with no mutation; a throwing body getter proves no read. Missing/identity mixed-case values must retain successful dispatch. Missing credentials, authentication dependency failure and failed mandatory auth audit retain precedence over invalid coding. Real loopback Node requests must also reject gzip-labelled JSON. Capture meaningful RED before the minimal header validation, then focused GREEN, typecheck/lint/scripts/compatibility and full check.

## Delivery
Independent main-based numbered branch, exact-head CI and independent formal approval before merge. Rollback removes this header validation. Local loopback and injected ports do not certify company SSO, browser sessions, installed PostgreSQL/runtime or paid-provider acceptance. Preserve existing unrelated worktrees and security gates.
