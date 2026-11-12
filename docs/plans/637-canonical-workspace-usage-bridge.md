# Canonical workspace usage transport bridge (#637)

1. Reproduce the old workspace list/csv/invalidate API mismatch against canonical JSON and CSV clients; do not restore the old parser or audit stores.
2. Add a transport-only adapter preserving the workspace result envelope while delegating all validation, bounds, timeout and request filtering to canonical clients. A new list or CSV read must cancel BOTH previous channels.
3. Test both cross-channel races, invalidation, empty/error mapping and real signed-JWT HTTP over owned PGlite with durable audit and exact request-filtered continuations. No browser credential acquisition, session policy, IAM, DDL, listener activation or provider changes.
4. Deliver a narrow commit atop #882 for #868 integration. Keep inherited review gates; no merge until exact CI and formal approval.
