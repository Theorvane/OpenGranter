# OpenCode streamed tool lifecycle and controls

Extend installed OpenCode 1.18.5 conformance over both bases with incremental read-function fragments, an actual temporary fixture-file read and correlated tool-result continuation. Evaluate fresh IAM and limits for every request; verify explicit model and provider Deny before secrets and process-termination cancellation with failed accounting. Restrict reads to the single temporary fixture, deny all other tools and external skills, and retain bounded child lifetime/output and cleanup. No product API, provider routing or schema behavior changes; broader app cancellation/failure semantics, direct streaming and full #116 remain open.

Response fragments/calls are confidential response content. No key, prompt,
argument or response enters operational audit/usage/error metadata. This
stage does not certify complete #116 compatibility.

The tool probe allows the single project-relative fixture file only and forbids shell/write
tools. Split argument fragments assemble into one read call; actual read output must
return under the same call ID before final completion. Every request authenticates
and rechecks model/provider IAM and limits; explicit Deny wins before secret access.
Deny emits a structured status-403 error with exit code 1. Child termination is the
bounded disconnect case and requires upstream abort plus failed possibly-billed
unknown-usage accounting. Other interactive cancel/retry/error variants remain open.
