# Official SDK function-tool lifecycle conformance

## Issue and problem

- Issue: [#234](https://github.com/Theorvane/OpenGranter/issues/234), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Non-streaming function-tool requests/responses/history are implemented, but the official OpenRouter SDK socket harness covers text/streams rather than its tool serialization and complete two-request lifecycle.

## Scope and expected behavior

- Verify SDK 1.4.18 over actual sockets for /v1 and /api/v1, delegated OpenRouter and direct OpenAI, using existing native adapters and controlled fixed-host upstream fixtures.
- Preserve exact declaration/choice/parallel-call controls, function call IDs/names/serialized arguments and complete text-only tool-result histories. Verify separate attempt accounting and fresh authorization/limit checks for the follow-up.
- Test authentication, explicit model/provider Deny, limits, malformed upstream calls, pre-dispatch required audit failure and post-response audit failure. Operational metadata must exclude request/response/tool content and credentials.
- No automatic tool execution, live inference, production SDK dependency, runtime behavior change, new tool formats, native/streaming tools or complete conformance claim.

## Design

- Add a dedicated SDK socket suite through createNodeChatServer and real direct/delegated invokers. Fixtures only simulate upstream transport and trusted gateway ports.
- Inspect installed SDK field types under the repository planning skills; record observable SDK results rather than treating OpenAI-client coverage as proof. No new domain terms or ADRs.
- Start independently from current main. Existing streaming and SDK projection contracts remain unchanged; add a narrow tool-SDK contract and inventory/acceptance links.

## TDD plan

- Test-only coverage does not change production behavior, so an artificial red production cycle is not required. Execute newly written public-boundary conformance cases and address actual failures rather than weakening assertions.
- Verify complete lifecycle success, before-inference rejection, upstream-invalid possibly-billed failure and audit suppression; inspect transport and usage counts after awaited SDK requests.
- Run focused socket tests, format, then npm run check. Any discovered runtime defect requires a recorded failing regression before the smallest fix.

## Delivery

- Issue/plan/branch first, then tests and English contract/inventory updates. Open a focused PR with actual validation evidence and merge after CI/approval.
- Risks: SDK error objects may retain request/response content for debugging, so assert safe gateway messages/metadata without dumping raw SDK errors. Supplied fixture fingerprints avoid confusing the separate legacy omitted-fingerprint gap with tool support.
- Keep direct native tools, rich results, streaming tool deltas and named external-client workflows open. Rollback removes test/docs additions only.

## Validation evidence

- All sixteen new actual SDK socket cases passed on the existing implementation. Follow-up requests use the returned SDK call group; no production code change or artificial red cycle was needed.
- npm run check passed: 1,063 tests passing and one existing skip, strict type checking, lint, planning-document/link/contract checks and offline schema-pin integrity. The total reflects current merged main plus this independent test-only change, excluding pending metadata/paging branches.
- git diff --check passed. No live provider calls or production dependencies were introduced.
