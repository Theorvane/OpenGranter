# Optional content on stop completions

Direct OpenAI and delegated OpenRouter nonstream stop completions permit assistant
content null/missing independently of reasoning/refusal payloads, request flags or
usage categories, through both API bases. Preserve explicit null and normalize
missing content to null consistently with existing response shape; preserve stop,
validated optional fields and actual or missing usage without invented text,
reasoning, zero counts, costs or explanations for an empty response.

Valid empty/metadata-only reasoning details may accompany stop and length. Success
comes from supported terminal response semantics, not metadata granting authority.
Project only validated own reasoning/detail fields; inherited fields stay absent.
Malformed role/content/reasoning/details/refusal, envelope/model/finish mismatches
and inconsistent tools still fail safely. No-text null/unsupported finish remains
rejected. Existing filter/refusal/function paths remain intact.

Authentication, complete model/provider IAM with explicit Deny precedence, limits,
required usage/audit delivery gates, privacy and safe possible-billing failures
remain shared. Delivered stop is recorded as succeeded only after persistence; it
does not guarantee visible text or imply free usage. Unknown usage stays unknown.
Operational records/errors exclude content/preferences/history and credentials.
Response acceptance does not widen history inputs, native thinking or streams;
empty assistant responses are not automatically valid replay input.

Current [official OpenAPI](https://openrouter.ai/openapi.json) and
[API reference](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)
define optional nullable assistant content independently of stop/reasoning/usage.
Full pinned SDK 1.4.18 deserialization and actual OpenAI/OpenRouter SDK sockets accept
canonical null/stop on both bases/routes. SDK source preserves omission; gateway
missing-to-null is its existing documented normalization. Earlier successful source
retrieval confirmed the shape; a later retry timed out, so no fresh full-source
comparison is claimed. Unchanged v18 already selects the assistant shape. Broader
optional-content/rich/native/tool-stream/history and full #116 certification stay open.

See [plan](../docs/plans/326-no-text-stop.md),
[length](no-text-length.md), [scalar](nonstream-reasoning.md)
and [details](nonstream-reasoning-details.md).
