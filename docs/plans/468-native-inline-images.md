# Native Inline Image Inputs

## Issue and problem

- Issue: #468, following #464/#466 and tracking #116.
- Bounded inline user images reach direct OpenAI/delegated OpenRouter, but direct Anthropic/Gemini reject images before credentials even when native inline formats preserve them.
- Official Anthropic Messages base64 sources and Gemini generateContent inlineData can represent a reviewed subset without retrieving remote media.

## Scope and expected behavior

- Map user image parts with omitted detail to native ordered image/text arrays. Anthropic selects PNG/JPEG/WebP/GIF; Gemini selects PNG/JPEG/WebP as a conservative subset (generic Blob documentation also mentions GIF, so no universal GIF incompatibility is claimed).
- Preserve exact base64 payload/MIME, order, empty text and image-only messages across both chat bases, nonstream/text/function streams and correlated function-result histories.
- Native histories admit at most 20 images as an explicit local bound, plus the existing URL/history/part/body limits. All supplied detail values reject before credentials; no resolution-control equivalence is invented.
- Authentication, complete model/final-provider IAM/Deny, limits, registered fixed hosts, private audit/usage/errors, persistence and missing/possibly-billed usage remain shared. Images create no estimated tokens or billed cost.
- Remote/file input, output images, cache-marked images, richer parts and Jev text disclosure remain outside this change. Preserve three schema pins and #7's unresolved policy.

## Design

- Translate validated immutable image parts into provider-specific blocks before secret resolution. Share bounded inline image extraction and native-history count/role/detail checks; retain native function/result correlation and text/cache behavior.
- Permit Google arrays only for user image-bearing content; plain/marked text arrays unsupported by that converter remain rejected. Anthropic retains existing text/cache mapping.
- Split canonical captured data URLs without decoding pixels, resizing or transcoding. Native API/model/pixel limits can still reject an encoding-valid image.
- Alternatives: passing OpenAI blocks to native APIs loses semantics; dropping detail silently invents equivalence; remote media retrieval changes the trust boundary. All remain excluded.
- No costly new domain decision or ADR. Refer to updated PRD, architecture, acceptance, compatibility and native-inline-images/inline-image-inputs contracts.
- Sources: [Anthropic vision](https://platform.claude.com/docs/en/build-with-claude/vision), [Gemini image guide](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding), [Gemini Part/Blob](https://ai.google.dev/api/generate-content#Part), [media resolution](https://ai.google.dev/gemini-api/docs/media-resolution).

## TDD plan

- First reproduce an omitted-detail Anthropic image request through createChatHandler returning 502 instead of 200. Record the expected failure before production changes.
- Add exact native shape/order/MIME/image-only/count boundary tests, detail/Gemini GIF denial before secrets, auth/IAM/limits/persistence failure cases, missing usage, upstream failure, captured mutation and function continuation.
- Verify actual installed OpenAI/OpenRouter clients against local sockets on both bases and nonstream/text/function streams, with fresh current Deny on follow-up.
- Implement only shared native extraction and the two existing history converter changes; run focused tests, npm run format, npm run check and live schema comparison.

## Delivery

- Issue/new branch/plan, red test, minimal mapping, green/security/client tests, English contracts/docs, full checks, exact-head PR review/CI and authorized merge.
- Risks: upstream model/image-byte validity and pixel/native limits are not certified; supplied detail and richer formats remain partial compatibility gaps. Rollback reverts native conversion and restores blanket denial together.
- Include red/green commands, unchanged pin evidence, mock-only client scope and material limitations in the PR.

## Verification evidence

Bounded inline images were accepted at the gateway but direct Anthropic/Gemini rejected every image history. This adds omitted-detail user images to both native routes on both chat bases, nonstream completions, text streams and custom-function streams. Anthropic receives ordered base64 image sources for PNG/JPEG/WebP/GIF; Gemini receives ordered inlineData for PNG/JPEG/WebP. Preserve exact payload/MIME, empty text, image-only/multiple arrays and correlated tool-result continuations.

The selected native subset permits at most 20 image occurrences across the complete history. Every supplied detail remains rejected before credentials; no resolution equivalence is invented. Gemini GIF is outside this conservative local subset, not a universal upstream incompatibility claim. Shared snapshots/body serialization precede asynchronous secret resolution. Preserve public role/URL/encoding/cache/body restrictions, registered fixed hosts, complete model/final-provider IAM/Deny, limits, private audit/usage/errors, required persistence and missing/possibly-billed failed-attempt accounting. OpenAI/delegated and Jev behavior remain unchanged; all three structural pins are byte-identical.

Red: node --test test/native-inline-images.test.ts reproduced the public omitted-detail Anthropic request returning 502 instead of 200. Minimal native mapping made this test pass. Green: node --test test/native-inline-images.test.ts test/sdk-native-inline-images.test.ts test/inline-image-inputs.test.ts test/sdk-inline-image-inputs.test.ts passes 152 tests. New raw cases cover exact native order/MIME/count bounds, image-only/multiple parts, detail/GIF/cache/role denial, first-read and async capture, secret/upstream failures, missing usage and audit/ledger failure. Actual OpenAI7.23.0/OpenRouter1.4.18 sockets cover 48 successful native requests and eight fresh explicit provider Deny requests across both bases, text/function streams and function-result continuations; two additional OpenAI image-stream aborts cancel native bodies and retain failed possibly-billed accounting. No live inference is used.

npm run format and git diff --check pass. Full npm run check passes strict types, lint, 5482 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and all three offline pins. npm run compatibility:drift reports every selected subset unchanged against the fresh fixed-host bounded official retrieval.

Remaining limits: pixel/MIME authenticity, native model capability and live/provider certification are not validated; encoding-valid images can still fail upstream. Remote/file inputs, supplied native detail/resolution equivalence, broader MIME/image caching/output/richer inputs and complete external-client certification remain open under #116. Jev sendPrompt:true still rejects image histories before selector credentials; unresolved #7 stays open.


Full npm run check passes strict types, lint, 5482 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
