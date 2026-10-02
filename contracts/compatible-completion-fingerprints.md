# Compatible completion fingerprint projection

For normalized nonstream object:chat.completion responses, /api/v1 adds system_fingerprint:null when native output omits/has undefined fingerprint. Null explicitly represents unavailable protocol metadata, not a fabricated backend identity, provider assertion or determinism guarantee. Supplied exact string/null values remain intact.

The managed and delegated success boundaries apply this after required accounting/outcome audit, using a cloned compatible completion. Native provider outputs, recorded usage and /v1 omission are unchanged. Generic handler results without the completion discriminator remain unchanged. SSE and error envelopes do not use this projection. Malformed native fingerprints still fail under existing possibly-billed upstream failure handling.

Exact pinned official SDK socket tests verify omitted upstream fingerprints now deserialize on /api/v1 while /v1 retains its existing narrower omission contract. IAM/limits, required audit/ledger failures and operational metadata privacy remain shared. This addresses one nonstream schema gap only; discovery, streaming fingerprint null restrictions, sparse usage and full external-client conformance remain open.
