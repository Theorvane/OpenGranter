# Delegated token usage availability

OpenRouter chat responses use the same known-counter projection as [direct providers](direct-usage-availability.md). Preserve supplied nonnegative safe integers, including zero; omit missing counters; sanitize supplied invalid counters to null without carrying raw upstream strings, objects, arrays, or unrelated fields.

Derive an absent total only from two valid components. An unsafe sum is null. A supplied invalid total stays invalid. No counters omit the usage object. The existing delegated ledger marks complete valid counts reported, incomplete valid counts partial, all absent counts missing, and any invalid count invalid. A successful completion remains successful independently of reporting quality.

Provider bounds, response-model verification, fixed endpoint, secret handling, and failure metadata are unchanged. This is availability preservation, not billed-cost reconciliation, final-provider discovery, or validation of malformed usage containers.
