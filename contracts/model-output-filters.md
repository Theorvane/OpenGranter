# Authorized output modality lists

Issue #472. Plan: [472-model-output-filters](../docs/plans/472-model-output-filters.md).

GET /api/v1/models accepts output_modalities as one comma-separated string containing one to nine distinct values from text/image/embeddings/audio/video/rerank/decisions/speech/transcription. A model matches if its captured administrator-published output_modalities contains any requested value. all remains a standalone sentinel imposing no output condition; mixing it with a modality rejects. Omission retains the complete current authorized list without an implicit text default. Missing/empty metadata cannot satisfy an explicit list.

Empty items, duplicate items, unknown values, casing/whitespace variants and repeated query keys reject400 before catalog reads. This strict syntax is a local subset: the source schema is a plain string, and the upstream accepts duplicates. Input modalities and supported parameters use all-member lists under [#474](model-capability-lists.md). Different supplied fields still combine conjunctively, followed by established ordering and optional paging.

Validate the entire catalog, then enabled model AND final-provider IAM, before any-member filtering. Denied/disabled aliases never affect matching totals or offsets. Fixed relative continuation links retain every accepted field and the output list in its original validated order as one URL-encoded scalar. Each page authenticates and reevaluates current catalog/IAM without snapshot guarantees. Filter-only lists retain full-list behavior above500; paging bounds/defaults remain unchanged. /v1 still rejects query strings.

Required sanitized audit precedes output. Listing calls no route, inference, provider-secret, limit or usage ports. Errors/events exclude filters and private metadata; whole-catalog, audit failure and immutable metadata guarantees remain shared. A metadata match grants no invocation permission or selected-provider capability guarantee.

Installed OpenRouter1.4.18 and OpenAI7.23.0 socket cases exercise union selection, retained pagination and fresh Deny. All three source pins remain unchanged. Other discovery filters, metadata refresh, full #116 and unresolved #7 remain open.

Sources checked2026-10-06: [official models guide](https://openrouter.ai/docs/guides/overview/models), [official models reference](https://openrouter.ai/docs/api/api-reference/models/get-models). Union semantics are supported by the guide example and credential-free official response observations containing both text-only and image-only models; exact implementation and local syntax bounds are not encoded in the structural schema.
