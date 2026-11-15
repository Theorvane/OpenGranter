# Browser workspace integration (#637, #642)

1. Reuse PR920 as the sole Models/Operations navigation owner. Add only an explicit caller-owned browser adapter; no public entry or authority source.
2. Write failing acceptance cases for locked start, actual CSV Blob dispatch, navigation cleanup, pagehide teardown, BFCache locked restoration, and idempotent disposal.
3. Connect the existing workspace to createCsvDownload using browser ports. Fence authorization while hidden and after disposal. Never restore a previous grant automatically. Remove lifecycle listeners on disposal.
4. Test exact UTF-8 CSV bytes, object URL cleanup, stale controls and fresh trusted authorization. Exercise the adapter in a real browser separately from synthetic transport tests.
5. Run typecheck, focused regressions, contracts and CI; obtain exact-head formal approval before merge. No installed/company SSO/provider or public deployment claim.
