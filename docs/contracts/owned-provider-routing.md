# Opt-in owned provider routing (#7 / THE-10)

## Boundary and prerequisites

`invokeOwnedRoute` is an exported composition core, not an HTTP endpoint or a default gateway route. The caller supplies an already authenticated principal/policy snapshot and administrator-approved registrations. Direct registrations dispatch to the existing registered direct adapters; OpenRouter registrations reference a server-held credential and fixed existing OpenRouter adapters. No caller URL is accepted.

The first slice does not implement configuration publication/storage migration, gateway composition, durable reservations, live health/capability/quota discovery, price/latency ranking, frontend controls, or production Jev. The current PostgreSQL audit projector also does not recognize the new `owned-*` events: a durable allowlisted projection/store adapter is a gateway-integration prerequisite, and directly wiring its existing append port would fail closed. Existing managed/delegated gateway behavior remains active. [ADR 0009](../adr/0009-owned-provider-routing.md) supersedes the old selection restrictions for this new contract only.

## Admission and deterministic behavior

Every candidate has a unique ID, registered transport, final inference-provider ID, upstream model, integer administrator priority and explicit trusted capability/health/quota eligibility evidence. Missing or false evidence excludes the candidate. Evidence freshness/discovery and model-specific verified OpenRouter slug mapping are the caller's prerequisites, not inferred by this core. Duplicate IDs/registrations or missing registrations deny configuration.

Reuse the policy evaluator: model alias and final provider must Allow, then registered transport provider must Allow. Explicit Deny and inactive principal remove candidates. An OpenRouter transport permission cannot replace final-provider permission. Filter before reservation or strategy calls; no eligible candidates deny with an attributed audit event.

Lower numeric priority wins, then candidate ID in JavaScript code-unit order, independent of input order or locale. A shared `RoutingStrategy` receives only frozen eligible ID/priority/provider/model metadata. Future price/latency/health strategies can use trusted metric snapshots keyed by those IDs; no metric collection or scoring algorithm is implemented here. An invalid, out-of-set, absent or throwing recommendation uses the deterministic first candidate. The remaining attempts follow deterministic order once each, without asking the strategy again.

## Reservation, audit and usage

The required `reserve` port atomically admits the complete bounded attempt set for a request ID and principal. It must cover at most one attempt per candidate, including uncertainty and possible duplicate billing; undefined or exception denies before selection/inference. There is no concrete reservation implementation in this repository. A no-op or boolean quota check does not meet this contract.

The lease's required `complete` method reconciles durable attempt usage, retaining funds for unknown outcomes rather than releasing them as zero. It runs on every post-admission outcome. Its failure returns `reservation-reconciliation` and conservatively reports possible billing whenever an adapter was entered; do not retry the request or release funds automatically. Crash recovery/idempotency and actual monetary limits are infrastructure prerequisites.

Required selection-start audit precedes the external strategy; the selected ID and a bounded strategy category (administrator-priority, Jev-research or custom) are audited before inference, distinguishing a recommendation from deterministic fallback. The existing managed executor supplies attributed attempt and usage events; its order decision describes execution order, while `owned-selection` records recommendation provenance. For compatibility with the current ledger, this opt-in executor uses `managed` attempt IDs (`request/managed/N`) and final-provider IDs even for OpenRouter transports; the immutable route version and candidate ID resolve transport identity. Do not also run the delegated coordinator or write a second usage record for the same attempt. Each failed attempt, including explicitly unbilled failures, is recorded before fallback. Missing accounting ports, failed accounting or required audit stop execution/replay. Unknown usage remains unknown; earlier possible billing carries duplicate-cost uncertainty.

Only classified retryable failures before upstream response/stream start allow fallback. OpenRouter failure metadata is translated to the existing executor without weakening the response-started flag. Unclassified exceptions conservatively mean response-started and possibly billed. A singleton OpenRouter `provider.only` bound prevents choosing another final provider; no multi-model fallback array is sent. Streaming HTTP integration remains a subsequent slice; injected streaming adapters must report response start honestly, and no streaming readiness is claimed here.

## Sanhouse research strategy

The request is exactly `state`, `instruction`, `options` at `https://jev.sanhouse.kr/v1/decisions`, with server-held Bearer credentials, redirect rejection and no retries. This is not the hosted TypeSafe questions schema. Both explicit enablement and `environment: research` are required; omission or production makes zero decision/credential/network calls. Prompt sharing requires a separate explicit `sharePrompt: true`; omission shares eligible metadata only. No customer prompts or live calls were used in validation.

The decoder is an injectable consumer boundary; absent decoder treats raw unknown as fallback. `decodeSanhouseResearchChoice` accepts only the historical Infra fixture's consistent index/choice and finite [0,1] probability array of matching length, sum within 0.00001 of one, untruncated state, and observed `CC-BY-NC-4.0`/false commercial/action/calibration flags. Unknown extra metadata is ignored. The selected mass must be at least 0.7 with a 0.2 margin; these are unvalidated concentration heuristics, not calibrated confidence or authorization. The fixture does not guarantee current server schema or task accuracy.

Timeout (at most three seconds, including an uncooperative transport), malformed/out-of-set/uncertain responses, missing credentials and HTTP/JSON failures fall back deterministically. Bodies, upstream errors, tokens, model-provided metadata and prompts do not enter operational audit. Jev decision cost accounting/reconciliation is not implemented; research transport use does not certify operational or paid use.

## Executable cases

- `test/owned-routing.test.ts`: priority/ties, denied and excluded candidates, both OpenRouter permissions, singleton adapter bounds, reservation denial/failure/reconciliation, usage barriers, cross-transport fallback, response-start replay and strategy membership.
- `test/sanhouse-strategy.test.ts`: historical fixture validation, disabled/production gates (also in owned tests), default privacy, explicit sharing, malformed/failure/uncertainty/timeouts and fixed transport.

Full OpenRouter external-client compatibility remains tracked by #116. This core does not expand the public request schema or claim full compatibility.
