# CSV continuation progress

## Issue and problem
Refs #642 / #637. CSV browser transport accepts a repeated or backwards continuation, allowing the UI to repeat pages indefinitely.

## Scope and expected behavior
Reject non-progressing continuation metadata as unavailable before reading CSV. Preserve server authorization, redaction, exact billing and bounded cancellation. No navigation, session, endpoint, provider or runtime changes.

## Design
Compare validated cursor tuples using descending timestamp and UTF-8 attempt-ID order, matching the existing server keyset contract. Capture the submitted cursor from the serialized query before awaiting transport. No browser Buffer dependency. Opaque cursor strings are never manufactured for navigation; decoding is validation only. CSV row correctness remains the server responsibility. Session and installed acceptance remain open.

## TDD plan
First public-client regression rejects repeated and backwards cursor headers (expected RED: ready). Cover advancing timestamps, UTF-8 tie order and mutation during await. Correct the previous happy-path fixture which reused the submitted cursor. Run focused tests, typecheck, lint, documentation check and full npm run check.

## Delivery
Update contract, PRD, architecture and acceptance. Main-based issue branch, PR with RED/GREEN and exact-head CI/formal approval before merge. Rollback removes client guard only; no migrations or deployment.
