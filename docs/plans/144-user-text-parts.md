# User text content parts

## Issue and problem

- Issue: [#144](https://github.com/Theorvane/OpenGranter/issues/144), compatibility parent #116.
- External clients use text-part arrays; the supported gateway currently rejects them despite supporting the equivalent text through all four adapters.

## Scope and expected behavior

- Accept a nonempty dense array of exact text parts only for user messages on both HTTP paths. Concatenate text in order without adding separators, preserving whitespace, Unicode and empty segments.
- Keep normalized internal/native message content a string. Reject unsupported/mixed modalities, malformed/empty/sparse arrays, extra part keys and arrays on other roles before route/credentials/transport.
- Preserve string input, existing instruction ordering, token/sampling controls, authentication, IAM, limits, required audit and usage. Raw native adapter array input remains outside the typed text contract.
- No image/audio/file/tool support, cache-control metadata or full content-array semantics. Concatenation does not preserve native text-block/cache boundaries; compatibility remains partial.

## Design

- Extend HTTP message decoding with a small pure content normalizer; retain the existing validated message protocol and build copied string-content messages.
- The external API subset maps text arrays onto the established native text path rather than forwarding arbitrary content objects. Unsupported parts fail the entire request, never silently truncate.
- Current [OpenRouter overview](https://openrouter.ai/docs/api_reference/overview) describes user ContentPart arrays. Other roles and full official referenced schemas remain future work.
- Keep pending PR #143 developer/message-snapshot work independent. If it merges, integrate its validation boundary while preserving this HTTP normalization and its restrictions.
- Update [contract](../../contracts/client-user-text-parts.md), PRD, architecture, acceptance and compatibility inventory. No policy, route or irreversible domain change.

## TDD plan

- Public HTTP/actual SDK cases first: four provider mappings and both paths, exact ordered concatenation including whitespace/Unicode/empty segments, string parity and existing controls.
- Invalid part/role shapes deny before routing with safe audit; IAM/limits/required audit still prevent transport; upstream failure still records safe failed-attempt usage.
- Record red, implement minimal normalization, green; strict TypeScript/focused Biome and full npm run check before PR.

## Delivery

- No migration/dependency/live inference/key. Document block-boundary and modality limitations; retain the full compatibility gate under #116.
- Integrate current main and report exact validation plus CI/review status in the ready PR.

## Verification evidence

- Red: eleven new public HTTP/actual-SDK cases produced ten failures and one pass against the prior implementation, reproducing text-array rejection.
- Green: all eleven cases pass after normalization, covering both paths/four providers, literal concatenation and string parity, empty text segments, combined controls, malformed/mixed/other-role denial before routes, IAM/limits/required audit and safe failed-attempt usage.
- Strict TypeScript, focused warning-free Biome and diff checks pass. Final integrated npm run check is required before PR publication.
