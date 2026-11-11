# Exact request usage transport

Both usage clients accept optional requestId and serialize request_id on their fixed JSON/CSV usage endpoint. It must be 1..256 ASCII characters, start alphanumeric and continue with alphanumerics or . _ + : / @ -. Exact case-sensitive match, no normalization. Invalid input fails before transport. Existing principal/model/time/page filters intersect it. JSON validates every row against the owned request filter; mutation during await cannot change validation. CSV remains verbatim with existing byte/deadline/continuation validation and relies on server scope validation. No new permission or DOM/download/session. Preserve all filters with continuations.

Dependency: backend #880, scoped runtime #855 and framing guard #859. Reconciles JSON transport from #742 without its UI; adds CSV support. No credentials, provider call, runtime default, DDL or policy change.

Plan: [implementation](../docs/plans/642-request-client-transport.md).
