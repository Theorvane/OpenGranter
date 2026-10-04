# Official SDK streamed function workflow conformance

- Installed OpenAI 7.23.0 and OpenRouter 1.4.18 clients are verified on real local sockets over both chat bases with interleaved indexed function fragments and a subsequent complete tool-result request.
- Re-evaluate authentication, model/provider IAM and limits on each request; verify Deny prevents the second call and secrets. Usage/audit persistence gates final success, missing usage stays unknown, safe failures do not replay, and SDK cancellation reaches the upstream read.
- Response arguments stay out of operational records. This test-only stage changes no production behavior, SDK versions or pin; broader external-tool certification, direct streaming and transitive schema drift remain open.

Response fragments/calls are confidential response content. No key, prompt,
argument or response enters operational audit/usage/error metadata. This
stage does not certify complete #116 compatibility.

## Installed client error and cancellation behavior

OpenAI 7.23.0 may end iteration normally after explicit client abort; the gateway
still cancels the upstream read and records failed possibly-billed usage and an
interruption. OpenRouter 1.4.18 can yield a structured error chunk on /api/v1
after partial output, while its legacy /v1 parser rejects the legacy error
envelope. A yielded error must be treated as failure by consumers; the gateway
withholds final usage and DONE after required persistence or upstream failure.
Conformance verifies error signaling and server accounting, not identical SDK
exception behavior. No production or SDK version changes are made here.
