# Administrator-published model identifiers

Issue #478. Plan: [478-model-identifier-metadata](../docs/plans/478-model-identifier-metadata.md).

Complete openRouterMetadata snapshots may supply own optional hugging_face_id:string|null and architecture.instruct_type:string|null, and architecture.tokenizer:string. Each string permits 0..256 UTF-16 units with exact whitespace/empty/Unicode spelling; preserve null and omission independently. Known and future enum strings remain valid. Supplied own undefined, invalid scalar types, tokenizer null and oversized strings fail the entire snapshot with fixed errors. Inherited optional fields stay omitted. Capture each value once and freeze the existing root/nested snapshot; getter failures remain private.

Only enabled model AND final-provider IAM-authorized aliases expose these fields on GET /api/v1/models after complete catalog validation, existing filters/order/paging and required private audit. Malformed denied/disabled/out-of-page snapshots still fail the whole catalog. Current policy is reevaluated per page; basic aliases and /v1 keep their existing shape. Search and capability predicates do not expand to these fields. Listing invokes no inference, secret, routing, limit or usage ports.

Identifiers are opaque informational administrator data. They cannot grant model/provider authority, load tokenizers, fetch URLs or Hugging Face models, transform prompts, estimate tokens, override an alias/route or establish billed cost. No metadata refresh, publication API, native adapter behavior, strict repository-reference grammar or tokenizer-based accounting is implied.

PostgreSQL listing and route resolution reuse the shared validator, preserve exact captured identifiers and retain approved route contents. Nullable JSONB object storage and the 64 KiB cap remain unchanged with no migration/backfill. Downgrade requires removing these new fields before using the old validator.

Installed OpenRouter 1.4.18 maps huggingFaceId and architecture.instructType, preserving architecture.tokenizer including open enum strings. OpenAI 7.23.0 preserves raw additional JSON fields despite narrower Model types. Public/storage/SDK tests cover success, denial, required failures, mutation, bounds and safe malformed rejection. All three existing schema pins remain byte-identical. Local bounds/own capture are restrictions rather than source guarantees; metadata may be stale. Broader optional fields, publication/refresh, full #116 and unresolved #7 remain open.

Sources: [official schema](https://openrouter.ai/openapi.json), [models reference](https://openrouter.ai/docs/guides/overview/models).
