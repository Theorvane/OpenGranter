# Whole-action CSV export deadline

Both exportFilteredUsageCsv and exportFilteredAuditCsv accept optional maxDurationMs: a safe integer from 1 to 120000 inclusive, default 60000. Invalid options fail as invalid_query before transport. This monotonic deadline begins once per explicit action and is not reset by pagination or bytes. Expiry invalidates only the dedicated export client and returns unavailable, never partial CSV. Caller abort takes cancelled precedence; late transport/body completion cannot produce a CSV. Success/failure clears the whole-action timer. Per-page existing timeouts, fresh IAM and mandatory durable read audit remain unchanged.

The deadline limits local waiting, not server work or audit completion, and cannot preempt synchronous JavaScript/event-loop stalls. On resume, elapsed time is checked before completion. No server snapshot, settlement, new authority, browser wiring, session or deployment is granted.
