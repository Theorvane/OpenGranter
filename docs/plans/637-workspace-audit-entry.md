# Workspace audit artifact/process integration (#637, #642)

1. Keep legacy browser/proxy entry points and UI-owned sources unchanged. Add explicit workspace-only typed optional audit writer wiring from trusted factory through artifact bootstrap to runtime. No schema/session/production activation.
2. Reject owned invalid writer values before service start. Absence keeps 404; keep exact writer reference, process-owned lifecycle fields, sanitized diagnostics and shutdown.
3. RED: invalid writer values must not reach an injected starter. GREEN: workspace-specific port types and validation.
4. Exercise actual built public artifact -> loopback HTTP -> signed fixture SSO/fresh IAM -> disposable SQL audit history JSON/CSV and failed writer. In-memory test writer is not installed durability. Preserve Account/models/credentials and test-only candidate DDL.
5. Run targeted tests, full typecheck/lint/scripts and diffcheck, publish draft PR, request exact-head formal review. No merge without all required CI and formal approval. Native UI/company SSO/installed provider acceptance remain separate gates.
