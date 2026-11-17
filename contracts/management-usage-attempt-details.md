# Authorized usage attempt metadata details

Each ready usage row exposes a collapsed native details/summary named Inspect attempt. It displays only fields already present in validated role-scoped usage JSON. Route kind is the recorded managed/delegated kind; upstream model and candidate are exact IDs, not alias resolution. Actual inference provider is displayed only when reported, otherwise Unknown; candidate is not a provider inference. Latency uses milliseconds; null token counts display Unknown and zero stays 0. Existing cost/duplicate/possibly-billed labels remain unchanged.

Metadata is textContent-only in a definition list. Never copy arbitrary row keys, credentialId, policy context, prompt/response or tool data. The server remains authoritative. There is no new request, session, storage, mutation, routing or billing behavior. The existing history renderer owns all nodes; loading/error, tab change, authorization loss and disposal remove their active DOM. This cannot recall data already observed.

Acceptance: actual history-client integration; managed/delegated exact metadata; null versus zero; hostile text has no HTML/script nodes; sensitive/unknown keys absent; no extra requests to expand; native disclosure collapsed by default; removal on filters/tab/denial/disposal.

Provenance: reuses the renderer from legacy unmerged PR702 exact4c29dfddf0e40b24ac39816a31a92e02638f1c76. This is integration into canonical history, not a newly invented metadata feature. Request ID, estimated price version and reported billing source remain available as in that reviewed-candidate implementation; outcome is additive. Legacy usage-app source is not imported or duplicated.
