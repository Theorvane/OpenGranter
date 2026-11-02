# Disposable PostgreSQL logical schema-loss recovery (#660)

## 1. Existing scope and gap

Extend #643/#566/#633/#654 cold logical recovery acceptance. The current row-deletion restore keeps database tables intact and cannot prove archive DDL reconstruction. Add one disposable CI phase in both host/bridge modes. Do not change runtime/API/IAM/provider ports or #561; do not claim database-server/volume loss, version rollback, installed target or live-client acceptance.

## 2. Design and acceptance

With the gateway stopped, create a private custom-format archive in the transient fixture. Drop only the disposable database public schema with CASCADE. Prove both catalog_models and schema_migrations are absent before restore. Restore fail-fast with clean/if-exists/no-owner/no-privileges, then assert exact disabled sentinel and original migration versions/checksums/timestamps before gateway startup can repair anything. Reuse bounded HTTP401, data/history equality and graceful SIGTERM checks. Keep deny-all bootstrap, archive permissions, explicit network flags and EXIT cleanup. No production connection or secret exists in this CI fixture.

## 3. TDD and delivery gates

First add an ordering contract regression for stopped gateway/archive/schema loss/absence/restore/pre-start history and repeat HTTP/stop. Demonstrate RED on the unchanged workflow, implement and demonstrate GREEN. Mutate absence proof and schema-loss command to confirm regression sensitivity. Validate shell syntax, scripts/contracts/pins, focused tests, lint/typecheck and unchanged full check. Docker is unavailable locally: exact-head host/bridge CI must execute recovery before merge. Require all exact-head CI SUCCESS and independent formal APPROVED; read-only review is not approval.

## 4. Remaining boundaries

This is logical public-schema recovery in the same disposable PostgreSQL instance, not a lost volume or database-server restore. Existing installed deployment, operational rollback, approved provider/client/budget and broader #637 gates remain open.

## 5. Local checkpoint

RED: unchanged workflow gives 5 pass and 1 expected failure for the absent schema-loss phase. GREEN: 9 focused networking/packaging tests pass with no skips. Three isolated mutations (schema drop, absence proof, pre-start migration history) are rejected. All three workflow Bash blocks, typecheck, documentation/contracts/fixture scan, pinned compatibility and whitespace checks pass. Biome focused formatting corrected before commit. Unchanged full check is running; exact-head CI and independent formal approval remain mandatory. Docker is unavailable locally. Initial full-check launch hit tool cwd remapping before execution; corrected to explicit shell cd, without repository or shared-tool changes.

## 6. Exact-head CI correction

Both network modes on 5ce20b0 failed because PostgreSQL 16 pg_dump omits the built-in public schema creation while its tables are archived. After proving table absence, explicitly recreate the empty public schema with ON_ERROR_STOP before pg_restore. Preserve all pre-start sentinel/history checks. Add an ordered regression that fails without schema creation, then rerun the focused and full checks and both exact-head CI modes. No approval or merge until the changed head passes independent formal review and all CI.
