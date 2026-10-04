# Streamed function fragment schema drift selection

- Extend selected streaming definitions from four to five by pinning the entire ChatStreamToolCall definition, including its inline function name and arguments. Keep 23 request fields and all other selected maps unchanged.
- Preserve verified canonical source provenance from the cached 2026-10-04 official document; version 19 records the expanded projection, not a fresh full-source comparison.
- Detect unchanged-parent nested structural drift and malformed or rehashed stale/extra/missing maps; editorial annotations remain ignored. Runtime bounds and exact-key rules remain local restrictions without invented source limits.
- No service, IAM, audit, usage or request behavior changes. Named external-tool and broader structural coverage remain open under #116.

Response fragments/calls are confidential response content. No key, prompt,
argument or response enters operational audit/usage/error metadata. This
stage does not certify complete #116 compatibility.
