# Function tool control capture consistency

Public declaration snapshots capture tools length/fixed indexed positions before
reading nested definition fields. Capture each type/function reference and name/
description/parameters/strict value once; validate, deeply freeze and project only
those first captures. Named function choices likewise forward the first validated
name. Optional undefined stays omitted, strict booleans/null stay exact and invalid
first values reject without retries/coercion before credentials.

Preserve exact allowed keys, plain Object/null prototypes, dense arrays, 20,000
maximum declarations, nonempty names of at most 64 UTF-16 units and schema JSON
limits. Nested JSON arrays capture one validated length for budget checks and
indexed descriptor traversal. Nested accessor properties/elements still reject
without executing getters; cycles/nonfinite/sparse/deep/over-budget values reject.
Parameter copies stay deeply frozen, including shared bounded-JSON consumers such
as response formats. This does not guarantee atomic arbitrary object graphs or
Proxy traps before accessor execution.

Public regressions and direct/delegated adapters verify exact selected/declared
controls through credential-await mutation, or safe pre-secret rejection. HTTP
JSON cannot contain accessors, so no network exploit or credential disclosure is
claimed. Accepted JSON/provider/policy contracts, native unsupported guards,
auth/IAM/Deny/limits, required usage/audit, privacy and safe billing failures stay
shared. Tool declarations never grant routing or execution authority.

Pin v18 stays unchanged; no fresh source comparison or complete #116 certification
is claimed. Native/rich/tool-stream gaps remain open. See
[plan](../docs/plans/338-function-tool-capture.md),
[function controls](client-function-tools.md), and
[function history capture](function-history-capture.md).
