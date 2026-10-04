# Capture content parts before normalization

The public text/refusal normalizer captures the fixed indexed part sequence before
validating fields. Read each discriminator and supported text/refusal payload once;
validate and normalize exactly that value. A getter returning a valid string first
cannot substitute a later value during concatenation; invalid first captures
reject without retrying, coercing objects or invoking payload toString.

Array-index getters are read once; replacement or append during discriminator
validation cannot change the captured sequence. This is a snapshot of positions,
not a promise to freeze arbitrary caller object graphs before getters execute.
Downstream immutable ChatMessage snapshots retain validated canonical values
before asynchronous routing/credentials.

Text order/Unicode/whitespace/empty segments, exact keys and dense-array validation
remain unchanged. Preserve existing inherited text properties deliberately; refusal
parts still require own discriminator/payload and exact keys. Sole assistant
refusal translation and conflicting scalar/mixed/duplicate rejection remain intact.
No JSON shape, provider mapping, raw typed adapter or policy contract expands.

HTTP JSON cannot contain getters; local public-helper accessors reproduce this
correctness defect. This is not a claimed network exploit or credential disclosure.
Public capture-to-HTTP tests and existing SDK/provider/security suites retain
both bases, all established text mappings, role/pending-tool validation, IAM/Deny/
limits, required audit/usage, safe failures, unknown usage and operational privacy.

Pin v18 and accepted SDK shapes stay unchanged; no fresh source comparison or
complete #116 certification is asserted. Rich/native/tool-stream gaps remain open.
See [plan](../docs/plans/334-content-part-capture.md),
[text parts](client-user-text-parts.md), and [refusal parts](client-refusal-parts.md).
