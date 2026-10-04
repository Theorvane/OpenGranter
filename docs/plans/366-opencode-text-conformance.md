# Isolated OpenCode text conformance

## Issue and problem

- Issue: #366; release gate #116 remains open. Installed SDK tests do not establish named external-application behavior.

## Scope and expected behavior

Register a custom @ai-sdk/openai-compatible provider with an explicit proxy-token environment reference and chosen model. Verify installed OpenCode 1.18.5 with an opt-in local socket runner over both bases, fresh temporary config/data/cache/work directories, bounded lifetime and cleanup. Do not write real user configuration or call a real upstream. Named-client model registration is explicit and does not claim automatic GET models discovery. This first test subject is reversible; broader clients and #116 remain open.

## Design

- Add an opt-in exact-version process runner and a loopback gateway fixture.
- Preserve text and public HTTP guards, fixed destinations and immutable capture.
- Preserve HOME and user configuration; isolate XDG directories, disable external skills
  and inherited client/provider configuration, bound child output/lifetime and cleanup.
- Register one explicit model; do not infer automatic discovery. Selection of this
  first application is reversible. Tool/error/cancellation workflows follow later.
- Update PRD, architecture, acceptance, compatibility and a dedicated contract.

## TDD plan

- Add helper behavior tests first; the missing process/config module is the expected red.
- Cover configuration/token references, environment isolation, successful process,
  missing binary, nonzero exit, timeout and oversized output. Run the installed
  client separately over both gateway bases; no additional default CI skip. Make the minimum implementation and run focused tests.
- Run format and full npm run check before review.

## Delivery

- Issue and plan before code; record red/green evidence in PR. Exact-head review
  by sjungwon03-ai and both CI checks precede sjungwon03 squash merge.
- Function fragments are response content, never operational audit/usage data.
- Missing usage remains unknown; do not claim complete #116 compatibility.

## Verification evidence

Add an explicit opt-in conformance runner for installed OpenCode 1.18.5, a custom chat-compatible provider configuration, and a fixed-host mocked transport behind the real gateway. Fresh temporary XDG/config/work directories, disabled external skills/plugins/config fetches, a whitelist of child environment variables and bounded child output/lifetime preserve user settings. Proxy-token configuration uses an environment reference. Explicit configured model listing is not automatic gateway discovery; this first named client is a reversible test choice.

Red: the new process/config boundary was absent; a subsequent regression reproduced split UTF-8 output corruption. Green: eight helper tests cover registration/isolation, success, missing binary, nonzero exit, timeout, oversized output and split Unicode. Separate npm run compatibility:opencode passes actual configured-model selection, text streaming and required usage/audit through both /v1 and /api/v1 with the installed client. The optional binary is not a default CI dependency and missing/version-mismatched clients fail explicitly. Tool and application-failure/cancellation workflows remain subsequent work. No service API or schema behavior change; documentation corrects stale version-18 footer wording after the prior version-19 increment. Full #116 remains open.


Full npm run check passes strict types, lint, 1665 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
