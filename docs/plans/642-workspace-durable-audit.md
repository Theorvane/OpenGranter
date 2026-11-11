# Workspace durable audit runtime integration (#637, #642)

1. Keep legacy processes and omitted/false workspace configuration unchanged. Select audit reads only with an own explicit boolean enableAuditHistoryReads.
2. Reject invalid values or simultaneous legacy writer and enabled SQL mode before acquiring database ownership. Validate at service and direct runtime boundaries.
3. RED: call the owned loopback listener against real ephemeral SQL; require missing candidate schema to fail closed, then isolated JSON/CSV and committed reader attribution.
4. GREEN: pass the existing owned autocommit connection to the concrete audit handler; never accept a second arbitrary SQL client or callback in enabled mode.
5. Test fresh Deny/revocation, failed durable audit, public shell without SQL authority, disabled mode, and idempotent close. No new migration, login, cookie bridge, IAM or default activation.
6. Run scoped integrations, full typecheck/lint and exact-head CI; require formal approval before merge. Native login, installed SQL/IdP and provider acceptance remain separate.
