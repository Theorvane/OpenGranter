# Token mutation response integrity (#640)

1. Reproduce issue/revoke clients reporting success from complete-looking JSON with an inconsistent identity Content-Length. Such transport failure cannot certify the outcome of an irreversible mutation.
2. Share a bounded UTF-8 JSON response reader between both clients. Validate unencoded/identity byte declarations before reading, enforce exact byte count at EOF and reject overflow immediately. Preserve decoded-byte caps for compressed Fetch responses without comparing wire length to decoded bytes.
3. Return the existing uncertain state on malformed/truncated/oversized responses, never retry and never expose partial secrets/errors. Preserve caller cancellation, ten-second wait bound, status handling and best-effort producer disposal.
4. RED/GREEN through public clients: both operations, multibyte exact lengths, invalid/unsafe declarations, early overflow, stalled producers, encoded bodies, malformed UTF-8, status denial, cancellation and no retry. Exercise the existing owned HTTP/migrated SQL mutation tests separately.
5. No endpoint, IAM, session, schema, panel, entry, deployment or paid calls change. Update PRD, architecture, acceptance and contract. Require exact-head full required CI and independent formal approval before merge.

## Local evidence

- Public-client RED: 6 pass / 8 fail before implementation; GREEN: 14 pass / 0 fail.
- Owned loopback HTTP with synthetic signed SSO and migrated embedded PostgreSQL RED: 0 pass / 2 fail; GREEN: 2 pass / 0 fail. Committed issue/revoke persists while damaged response is uncertain; fresh Deny prevents another lifecycle event. Metadata corruption is injected at the caller port, not native wire truncation.
- Focused token/lifecycle/owned HTTP regressions: 71 pass / 0 fail / 0 skip. Full strict typecheck and repository lint pass (existing 42 warnings / 174 infos), document checks and pinned compatibility pass. Full-suite/CI status is reported separately, not inferred from focused checks.
