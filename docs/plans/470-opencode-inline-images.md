# OpenCode Inline Image Conformance

## Issue and problem

- Issue: #470, tracking #116 and following #464/#468.
- OpenCode 1.18.5 has fifty previously recorded text/function/security probes but no measured local image attachment workflow. Runtime image mapping already exists on all four routes. Actual probes expose a #452 regression: the client emits X-Session-Id, whose global header fallback creates an unsupported native body field and prevents every managed inference before secrets.

## Scope and expected behavior

- Extend the pinned installed-client harness with one synthetic local PNG attachment on delegated OpenRouter and managed OpenAI/Anthropic/Gemini, both chat bases.
- Verify exact inline/native image bytes and omitted detail, rendered text, actual fixture-only read execution and image-preserving correlated result continuation.
- Verify initial model/provider Deny, fresh follow-up provider Deny and process termination with failed possibly-billed missing usage. Retain shared authentication, limits, registered hosts and metadata privacy.
- Preserve isolated temporary Git/config/data/cache/state, environment allowlist, disabled plugins/config/skills/model fetching, bounded lifetime/output and cleanup. No real provider or key is used.
- Scope correction from measured evidence: validate/capture the selected header before awaits but apply header-only fallback exclusively to delegated OpenRouter after approved route resolution. Managed invokers receive no header-derived session_id; explicit body values still reject natively before secrets. Native session equivalence, sticky state, arbitrary header forwarding and identity changes remain excluded.
- Out of scope: remote media, runtime image capability changes, pixel decoding, live model support, broader image formats, image output, automatic discovery, signed-image combinations, interactive cancellation and complete #116 certification. #7 remains unresolved.

## Design

- Inspect the exact installed CLI attachment/configuration contract before using it. This is a reversible fixture choice within the existing inline-image contract, not a new product policy.
- Reuse the existing gateway fixture and runner controls; supply a fixed CLI title in image probes to suppress automatic title inference, and require at least one captured request plus exactly one image on every request/continuation. Existing non-image probes retain auxiliary title handling.
- Select explicit image input modalities only for the fixture model in image probes. This config is not gateway catalog discovery or live capability proof.
- Update PRD, architecture, acceptance, OpenRouter compatibility checkpoint, reproduction guide and contracts/opencode-inline-images.md. Preserve all three source pins.
- Alternatives: SDK-only cases cannot certify an application attachment flow; live models introduce unnecessary credentials and nondeterminism. Use the pinned local application with mocked registered transports.
- Preserve the #452 body/header precedence, early bound and capture for delegated routes. Header-only native requests should remain ordinary native calls; do not invent a native session wire equivalent or transform the identifier into user/cache/metadata. This reversible HTTP scope correction fixes the measured named-client regression.
- No new glossary term or costly domain decision requires an ADR. Local client attachment/configuration facts are the only implementation prerequisite; unresolved release choices remain unchanged.

## TDD plan

- Add a configuration regression expecting explicit text/image input and text output modalities; run it before modifying the helper and record the missing modality failure.
- Add socket cases for the image fixture across four routes and both bases: text, tool-result replay, initial/follow-up Deny, cancellation and no content in operational records. Add exact image assertion negative cases to ensure a probe cannot pass after dropping or changing the image.
- First reproduce a real native socket image request with X-Session-Id returning 502 instead of 200; add this header to the four-route socket matrix before modifying production code. Verify header omission in every native body, delegated exact forwarding and explicit native body rejection. Add native header authentication/IAM/limit/persistence/malformed/capture regressions.
- Implement minimal header-scope correction plus fixture/config/runner extensions and run focused tests plus the exact installed-client command. Record observations before claiming the client subset passes.
- Run npm run format, npm run check and git diff --check. Existing runtime tests remain authoritative; the only production behavior change is omission of header-derived session_id on managed routes.

## Delivery

- Issue/new branch/plan precede coding. Deliver English PR with plan, red/green evidence, fixture-only client results and remaining risks, exact-head CI and authorized account review/merge.
- Risks: client attachment serialization may omit images without explicit modalities; fixed image titles suppress auxiliary title calls and every captured image-probe request must preserve the attachment. Valid header-only managed requests now proceed rather than failing; explicit body preferences and malformed selected headers remain rejected.
- Rollback reverts the gateway header-scope correction together with its regression tests and contract, plus the conformance harness/configuration. No native session wire mapping, IAM, secret, accounting or schema policy changes. Roll back the gateway header-scope correction with its contract update if necessary.

## Verification evidence

OpenCode 1.18.5 automatically sends X-Session-Id. The gateway's global OpenRouter header fallback introduced session_id into managed requests, where native transports rejected it before secret resolution; the client then retried 5xx. Scope header-only fallback to delegated routes after approved route resolution. Capture/validate the selected bounded value before awaits and preserve body presence: managed invokers omit only header-derived session_id, explicit native body identifiers still reject, and delegated exact forwarding/body precedence is unchanged. The header never controls authorization, route choice, limits or accounting identity. No native session equivalence or arbitrary header forwarding is introduced.

Extend isolated named-client conformance with a valid synthetic PNG, explicit fixture image modalities and omitted detail across delegated OpenRouter and managed OpenAI/Anthropic/Gemini on both bases. Image probes supply a fixed title and require exactly one unmodified image on every captured request, actual fixture.txt read execution, correlated result continuation, initial model/provider Deny, fresh follow-up Deny, native cancellation and private audit/usage. Retain environment/config/Git isolation, --pure, disabled external plugins/skills/config/model fetch, fixture-only tool permissions, bounded process lifetime/output and cleanup. The default command has 98 probes (existing fifty plus 48 image cases); final image-only rerun verifies the fixed-title/all-request assertions. No live inference is used.

Red/green: configuration regression first observed missing modalities; the minimal config extension passed. A new native OpenAI socket image case with X-Session-Id then reproduced 502 instead of 200 before production changes; the header-scope correction made it pass. Focused gateway/config/native/session/SDK suite passes 251 tests. Seventy-one new default-CI cases cover exact image payload assertions and all four route/base socket modes, native header success and explicit body rejection, early malformed-header rejection, async capture, authentication/IAM/limits, required audit/usage failures, upstream error and missing usage. Existing delegated body/header and SDK regressions remain green.

Full npm run check passes strict types, lint, 5553 tests with one existing PostgreSQL skip, planning/contracts/fixture scans and all three offline structural pins. npm run format and git diff --check pass. All three pinned JSON files are byte-identical to main. Update PRD, architecture, acceptance, session/image contracts, reproduction guide and the compatibility checkpoint (chat v31/24 selected request definitions plus query v2 and model response v1).

Material behavior change: valid header-only managed requests now proceed as ordinary native calls rather than failing before secrets. Explicit native body identifiers and selected overlong headers remain rejected. Native/live model image support, pixel/format limits, remote/detail/cache/output images, signed-image combinations, broader named-client versions/interactive behavior and complete #116 certification remain open. Jev #7 stays unresolved. Actual client results use only fixed mocked hosts and fixture keys; AI-assisted account review is not independent human certification.


Full npm run check passes strict types, lint, 5553 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
