# Bounded token mutation uploads (#640)

1. Reproduce authenticated issue/revoke JSON streams without EOF: the byte limit cannot bound lifetime.
2. Bound the entire body read to 30 seconds after authentication, not a sliding per-chunk timer. Preserve authentication-before-body, 16 KiB limit, strict UTF-8, exact request shapes, fresh IAM and durable audit.
3. Deadline returns existing private 400 invalid_request, cancels without awaiting producer cleanup, releases reader and never mutates from partial or late bytes. Valid complete input retains behavior.
4. RED/GREEN via public handler with deterministic time and unfinished real HTTP uploads; verify late data, abort, authentication denial, timer cleanup and existing regressions.
5. No new grant/session/browser activation/deployment/DDL. Require exact-head full required CI and independent formal approval before merge.
