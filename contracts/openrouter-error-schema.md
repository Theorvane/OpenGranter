# OpenRouter numeric error envelopes

Requests whose pathname starts /api/v1/ receive JSON failures with numeric error.code equal to HTTP status, fixed error.message and metadata.opengranter_code containing only the existing allowlisted symbolic reason. The gateway retains request_id and x-request-id. The Node pre-header internal fallback has the same format without inventing a request ID.

Legacy /v1 errors retain symbolic code and fixed message. Success payloads and every IAM, audit, limit and usage behavior remain unchanged. Choosing an error format does not change endpoint eligibility: unknown endpoints, wrong methods and near misses remain 404, and history extensions stay on /v1.

Only allowlisted metadata is produced. Raw exception/provider bodies, prompts and credentials remain excluded. Local typed error metadata does not recover precise upstream error causes or streaming errors; bounded nonstream retry headers are defined below. See [compatibility](../docs/openrouter-compatibility.md) and [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).

## Safe local typed errors

On /api/v1 paths, metadata.error_type uses a fixed allowlist alongside opengranter_code:

| Local reason | error_type |
| --- | --- |
| not_found, unknown_model | not_found |
| unauthorized | authentication |
| invalid_request | invalid_request |
| forbidden | permission_denied |
| limit_exceeded | rate_limit_exceeded |
| upstream_failed | unmapped |
| authentication_unavailable, audit_history_unavailable, usage_unavailable, catalog_unavailable, route_unavailable, credential_unavailable, audit_unavailable, internal_error | server |

These are local reason mappings, not recovered upstream diagnostics. In particular, server-held key failures are not client authentication failures and a generic upstream failure does not prove timeout, rate limiting, provider availability or moderation. The Node fallback maps internal_error to server. All statuses, fixed messages, request identifiers and legacy /v1 shape remain unchanged. No raw provider metadata or caller content is accepted by the serializer. HTTP-date/streaming retry hints, precise provider-cause propagation and full streaming parity remain open.

Source checked 2026-09-29: [OpenRouter typed error codes](https://openrouter.ai/docs/api_reference/errors-and-debugging).

## Bounded nonstream Retry-After (#548)

Both POST chat bases retain an advisory Retry-After from registered delegated OpenRouter or direct OpenAI/Anthropic/Gemini nonstream 429/503 responses. The #548 checkpoint retained generic 502 on both bases; #554 below preserves compatible observed 429/503 while legacy /v1 retains 502. Fixed messages, safe upstream_failed/unmapped metadata and request identifiers remain. For example, upstream 429 with Retry-After:0007 yields compatible 429 or legacy 502, both with Retry-After:7. Client retry/backoff behavior may depend on the selected status.

Capture only the HTTP-normalized header value consisting of 1..16 ASCII digits and a nonnegative safe-integer number of seconds. Zero is valid and leading zeros canonicalize. Missing/empty values, signs/fractions/exponents, commas/repeated fields, unsafe integers, overlong values, private strings and HTTP dates are omitted without replacing the original safe error. HTTP dates are allowed by the standard but remain outside this bounded implementation. No raw headers or provider error bodies pass through.

Known adapter failures and route results carry only an optional validated retryAfterSeconds scalar for rate-limit/server-error categories. Constructors, coordinators and the error serializer revalidate their respective boundaries. Only terminal upstream-failed/provider-failed results after successful required usage and outcome-audit handoffs can produce the header; persistence failures return their existing 503 without a hint. Successful fallback clears earlier hints, and a later terminal attempt may supply only its own hint. Current responseStarted/possiblyBilled flags, conservative missing-usage records and fallback eligibility remain unchanged.

No hints are emitted for other upstream statuses, success, local auth/IAM/limits/configuration/secret failures or timeouts. The hint is excluded from audit-event bodies, ledger fields and public error JSON. Streaming remains unchanged and is not covered by this header contract. No gateway sleep/retry, availability guarantee, duplicate-billing protection, HTTP-date normalization or full OpenRouter error parity is introduced. A new client retry still authenticates and evaluates current policy/limits normally.

Actual pinned OpenAI 7.23.0/OpenRouter 1.4.18 and OpenRouter AI SDK provider 3.1.0 with AI SDK 7.0.153 receive the canonical header across both bases/four routes with retries disabled. This certifies header delivery, not each SDK's automatic backoff behavior. See [plan](../docs/plans/548-upstream-retry-hints.md) and [compatibility](../docs/openrouter-compatibility.md). Primary sources checked 2026-10-28: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) and [RFC 9110 section 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after). Full #116 and unresolved Jev #7 stay open.

## Compatible observed upstream statuses (#554)

For nonstream POST /api/v1/chat/completions, terminal observed upstream 429/503 now retains that exact HTTP status after required failed-attempt usage and outcome audit succeed. Compatible numeric error.code equals the selected status; error.message remains fixed, metadata.opengranter_code remains upstream_failed and metadata.error_type remains unmapped. Request identifiers are preserved. This supersedes the compatible generic 502 projection in #548 only for these two statuses. Legacy /v1 keeps 502/symbolic upstream_failed, including its bounded Retry-After behavior.

Only known direct/delegated failure classes may carry optional upstreamStatus:429|503. Capture it at the nonstream registered-adapter boundary, require responseStarted===true and agreement with rate-limit429/server-error503, then revalidate in terminal route projection. Do not infer a status from failure category alone, arbitrary error.status fields, unclassified exceptions, upstream JSON/text or mismatched/malformed metadata. Other upstream statuses, missing status and timeouts retain generic 502. Compatible429/503 remains available when Retry-After is absent or invalid; hint validity is a separate bounded check.

The fixed serializer permits its existing validated Retry-After only on upstream_failed429/502/503. Local auth/IAM/limits/configuration and required persistence failures keep their existing status/reason and never inherit upstream status/hints. Required usage and outcome-audit awaits precede the response; failed handoffs produce the existing safe503 without hints. Final fallback outcome alone determines status/hint; success clears earlier values and unclassified terminal failure does not inherit an earlier429. Response-start/possibly-billed flags, conservative usage and duplicate-accounting semantics stay intact.

Observed status is a bounded protocol fact, not the upstream's exact typed cause, free-retry or availability promise. No raw error bodies/headers, new ledger/audit fields, gateway retries/sleeps, streaming error/status changes, HTTP-date/402 budget handling or full error parity are added. Client retry/backoff decisions may change because compatible429/503 is now distinguishable; actual OpenAI/OpenRouter/AI SDK probes disable retries and certify only status/header delivery. Source pins, dependencies and storage are unchanged. See [plan](../docs/plans/554-upstream-statuses.md) and [compatibility](../docs/openrouter-compatibility.md). Primary source checked 2026-10-29: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging). Full #116 and unresolved Jev #7 stay open.

## Pre-stream observed status and retry hints (#558)

For stream:true text and function chat on both bases/all four registered adapters, an upstream HTTP429/503 rejection may carry the same bounded status/hint metadata as nonstream #548/#554. Capture only these observed HTTP rejections at the response consumer, with matching classification and existing responseStarted:true/possiblyBilled:true flags. Cancel the rejected response body best-effort without retaining its content. Known failure constructors and terminal route projection retain their existing independent status/hint validation; unclassified exceptions cannot supply authority. Other statuses, invalid200 SSE bodies and malformed/date/unsafe/repeated hints do not gain advisory metadata.

Before the client SSE response starts, /api/v1 returns the exact observed429/503 as plain JSON with matching numeric error.code. /v1 retains502/symbolic upstream_failed. Both may return the canonical Retry-After header, including zero, after required failed-attempt usage and outcome audit complete. Fixed messages, unmapped safe error_type, request IDs and private missing/possibly-billed accounting remain. Missing/invalid hints do not suppress a valid status. Auth/IAM/limits/selection/secret and required persistence failures keep their own safe reason/status and cannot inherit an upstream hint; delayed usage/audit prevents the JSON response from settling.

Once the HTTP stream starts, status remains200 and existing safe SSE error projection remains: upstream_failed uses generic502 in compatible error.code, or the existing legacy symbolic reason. Discard upstream status/hint for that projection. Interruption-audit failure still produces the safe audit-unavailable error without an advisory. No final usage/DONE is emitted for failed streams. Already-delivered text is not a successful persistence acknowledgment.

Fallback eligibility is unchanged. Registered observed HTTP rejection remains responseStarted:true, so this increment does not create an automatic fallback or retry. Existing eligible pre-response classified failures may still fall back within approved scope; successful fallback clears earlier hints and a final failure uses only its own metadata. Cancellation, possible duplicate/billed accounting and required interruption audit retain existing rules. No new ledger/audit fields, raw body/header forwarding, sleeps, HTTP-date/402 handling, precise provider error_type or complete error parity is added.

Actual pinned OpenAI7.23.0/OpenRouter1.4.18 and AI SDK provider3.1.0/AI SDK7.0.153 receive pre-stream status/header on both bases/all four routes/text-function modes with retries disabled. This certifies delivery, not SDK automatic policy, availability or free retry. Source pins, dependencies and storage remain unchanged; full #116 and unresolved Jev #7 stay open. See [plan](../docs/plans/558-prestream-errors.md) and [compatibility](../docs/openrouter-compatibility.md). Primary sources checked2026-10-29: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) and [streaming](https://openrouter.ai/docs/api_reference/streaming).

## Canonical HTTP-date retry hints (#620)

The existing observed upstream429/503 nonstream and pre-stream paths additionally accept exact canonical IMF-fixdate Retry-After (29 ASCII characters, actual matching UTC calendar/weekday, year1601..9999). This supersedes earlier date-rejection descriptions for that bounded form only. Capture-time normalization is max(0, ceil((date - local wall-clock milliseconds)/1000)); past dates become zero. Numeric hints retain their existing16-digit/safe-integer restrictions independently of clock validity. Invalid clocks reject date hints. Raw date text and upstream Date headers never reach clients or operational records; Date-header clock-skew correction is not performed.

The normalized delay is advisory and captured before persistence, not recalculated at response delivery. Required usage/outcome audit, status eligibility, IAM/limits/privacy, fallback and post-frame isolation remain unchanged; no retries or sleeps are introduced. Clock accuracy is deployment-dependent. Obsolete RFC850/asctime forms, noncanonical spacing/case, leap seconds, duplicate values and mismatched weekdays/calendar dates remain unsupported. This is not full RFC9110 HTTP-date or #116 conformance. See [plan](../docs/plans/620-http-date-retry.md) and RFC9110 sections10.2.3/5.6.7.
