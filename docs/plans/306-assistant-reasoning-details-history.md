# Delegated assistant reasoning details history

## Issue and problem

- Issue: #306; release gate #116 remains open.
- Supported response reasoning_details cannot currently be replayed as assistant
  history, including complete function-call/result continuations.

## Scope and expected behavior

- Delegated OpenRouter preserves optional assistant summary/text/encrypted arrays,
  exact opaque strings, nullable metadata, omission, empty arrays and item order.
- Ordinary null/missing assistant content requires nonempty scalar reasoning or a
  validated nonempty summary/text/encrypted payload. Metadata alone is insufficient.
- Complete function groups retain existing pending-result validation. Other roles,
  malformed details and unsupported items reject before routing.
- Direct OpenAI/Anthropic/Gemini reject every supplied detail marker before secrets.
- Existing ordinary delegated streams preserve history; tool streams remain closed.
- Shared IAM, limits, required audit/usage and privacy remain unchanged. Client
  details are untrusted conversation data, never authentication or routing claims.
- Native thinking, server tools, structured request controls and complete external
  certification remain unresolved. No authenticity/decryption or token inference.

## Design

- Reuse snapshotReasoningDetails to capture each field once, freeze nested records
  and arrays, and project the validated snapshot before asynchronous operations.
- Extend assistant message type, strict snapshots, HTTP text-part normalization
  and direct unsupported-history guard; delegated transport already forwards history.
- Reuse established response variants rather than widening arbitrary JSON support.
- Update PRD, architecture, acceptance, compatibility and history contract.
- No new domain terms or costly irreversible trade-off: no glossary/ADR addition.

## TDD plan

- Public HTTP and actual SDK history success cases initially reject 400.
- Cover opaque payload/order, empty/metadata-only states, null/missing content,
  text parts, scalar coexistence, complete calls, malformed/non-assistant fields,
  once-read getters, immutable copies and mutation during secret resolution.
- Verify all direct kinds reject before secrets; independent model/provider Deny,
  authentication, limits, upstream and required persistence failure accounting.
- Run focused message/history tests and npm run check; schema pin remains unchanged.

## Delivery

- Issue/plan, failing tests, minimal implementation, green/full checks, exact-head
  sjungwon03-ai review, required CI, sjungwon03 merge and clean main synchronization.
- Report red/green evidence and remaining #116 gaps in PR. Roll back by reverting
  this bounded subset; opaque history has no policy or accounting authority.

## Source and verification evidence

- Installed OpenRouter SDK 1.4.18 maps reasoningDetails to reasoning_details,
  retaining declared summary/text/encrypted payloads, signature, metadata and
  order. It strips extra properties and supports additional server-tool variants
  outside our subset. Official guidance preserves entire original block sequences.
- New tests initially: 1 passed, 7 expected failures (400 histories and rejection
  before expected Deny/adapter/SDK paths). Focused final history suite: 49 passed.
- Actual SDK response-to-history replay covers both bases and ordinary delegated
  streams. Required persistence failures and independent IAM Deny are exercised.
- Full npm run check results and exact-head review/CI evidence are recorded in PR.
- Final npm run check: 1419 passed, one existing optional PostgreSQL integration
  skip; strict typecheck, lint, planning/links/contracts/secret scan and offline
  pinned-schema integrity passed. No live compatibility certification is claimed.
