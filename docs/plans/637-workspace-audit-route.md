# Workspace audit route integration

1. Add RED loopback workspace tests for explicit writer opt-in, real gateway audit SQL history/CSV, fresh IAM, fail-closed writer errors and lifecycle.
2. Connect the existing SSO audit service/handler inside the administration dispatcher only when a trusted access writer is supplied. Reject explicitly invalid writers. No new reader, schema or startup wrapper.
3. Carry the same explicit writer through the owned workspace runtime; reject invalid configuration before SQL acquisition. Preserve old runtime/review/default routes.
4. Run focused regressions, typecheck, lint and scripts checks; open a draft stacked PR and require exact-head CI plus independent formal approval.
5. Keep deployed activation blocked on approved durable writer/store and session decisions. Memory sinks demonstrate release ordering only, not durability.
