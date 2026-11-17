# History download framing (#642)

Implement bounded usage and audit CSV transport without changing authorization, pagination or UI ownership. Reject identity-body overflow immediately, cancel the producer and return unavailable without partial CSV. Fetch already decodes compression: cap decoded bytes rather than rejecting a legitimate compressed wire length larger than the decoded cap. Keep exact identity EOF length, strict UTF-8 and 15-second deadlines.

Tests first: stalled overflow cancels before the deadline; native loopback HTTP gzip expands and shrinks around the 2 MiB boundary; truncated native identity response fails; exact Unicode CSV survives. Synthetic ports cover impossible Fetch metadata separately. No session, IAM, endpoints, deployment or provider calls change. Full check and independent exact-head approval remain required.

## Evidence

Expanded public-client regression RED: 0/6 pass; GREEN: 6/6 pass. Native loopback HTTP covers gzip wire length over 2 MiB with a decoded page exactly at the cap, decoded overflow, exact Unicode CSV, truncated identity and no automatic retries. Separate injected-stream tests prove early cancellation; synthetic metadata is not described as native wire damage. Combined export/audit/history and signed synthetic JWT with migrated embedded PGlite HTTP regressions: 52/52 pass, zero skip. No company IdP, native PostgreSQL or installed-browser certification.
