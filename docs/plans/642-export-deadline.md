# Filtered CSV whole-action deadline (#642)

1. Preserve existing freshly authorized per-page usage/audit APIs and explicit caller cancellation. No UI ownership, session, schema or deployment changes.
2. Add one monotonic deadline for the entire filtered export, default 60 seconds and caller-selectable integer 1–120000 ms. Never restart it per page. Expiry aborts the dedicated client and returns unavailable without partial CSV. Caller cancellation retains cancelled precedence.
3. Prove RED then GREEN for stalled transport, stalled body, cumulative pagination, invalid bounds, successful cleanup and cancellation. Rerun existing exports and SQL/JWT/HTTP integrations, typecheck and scoped lint.
4. Submit exact HEAD for independent formal review and CI; no merge before required gates. Browser/UI and installed acceptance remain separate.
