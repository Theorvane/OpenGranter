# Durable current-principal authentication audit

Issue #770; follows [identity HTTP](sso-current-principal-http.md).

## Configuration and ownership

1. The PostgreSQL current-principal factories require exactly one own configuration field: the existing `writeAudit` callback OR a trusted `auditClient` SQL client. Both (including undefined) or neither are rejected. `auditClient` binds its query function and the already configured `now` clock when constructing the handler. No caller-provided authentication callback is accepted.
2. In SQL mode, the caller must supply an autocommit client/pool whose acknowledgement means the statement was durably committed. Do not supply an uncommitted transaction: this adapter cannot detect later rollback or override database durability settings. Separate identity/audit reads are not a serializable revocation transaction.
3. Proposed DDL is in `contracts/sql/current-principal-audit.sql`. It is NOT part of the default migration manifest, run automatically, or installed by the factory. Schema ownership/security review and explicit installation remain prerequisites. Default deployments remain unchanged; opting in without the table fails closed.
4. No session/BFF/CSRF/CORS/IdP, runtime listener, policy grant, audit-reader permission, retention policy, deployment or provider call is enabled. This is identity context, not authorization.

## Persistent projection

1. One parameterized INSERT persists server timestamp, request ID, outcome and principal ID. Outcomes are `ready`, `unauthenticated`, `unavailable`. Only ready has a non-null authenticated principal ID; both failure outcomes must have null identity. Database identity event IDs are positive signed-bigint strings on acknowledgement.
2. Required fields must be own properties. Request IDs are 1..256 safe server-identifier characters. Principal IDs retain the identity HTTP's 1..256 UTF-16-unit opaque-ID subset, excluding controls and unpaired surrogates. Extras are ignored without reading their values. Tokens, cookies, issuer/subject, claims, policies, proxy credentials and prompt/response content never enter SQL parameters.
3. No IAM foreign key or synthetic credential attribution is used. A principal deletion must not erase historical audit facts. Reader/export/retention authority remains unresolved and this change adds no read API.
4. Validation and projection precede SQL; no event reference survives an asynchronous boundary. The adapter captures the query function, not a later mutable replacement on configuration.

## Required persistence failure semantics

1. The public HTTP boundary awaits INSERT acknowledgement before releasing identity or returning authentication denial/unavailability. An absent table, rejected SQL, invalid clock, missing/duplicate/malformed acknowledgement or out-of-range ID yields fixed `CurrentPrincipalAuditUnavailable` internally and `503 audit_unavailable` publicly, with identity suppressed.
2. Invalid audit events fail before SQL with fixed `InvalidCurrentPrincipalAuditEvent`. Causes, database text and tokens are not included in either error. A failed acknowledgement may follow a committed statement: do not retry blindly or promise exactly-once records. Request IDs correlate records but are not deduplication keys.
3. Invalid framing/path/method and already-aborted requests retain the existing handler's pre-authentication rejection behavior and do not add an authentication event.

## Evidence boundary

Locally signed JWTs, migrated PGlite, file-backed close/reopen and actual Node loopback HTTP establish local public-boundary persistence behavior, not installed PostgreSQL fsync guarantees, company SSO, browser session acceptance, approved migration installation or live model use. Existing callback mode remains available only with the same required genuinely durable ownership contract.
