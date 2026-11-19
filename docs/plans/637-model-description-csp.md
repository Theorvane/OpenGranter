# 637: CSP-compatible model descriptions

## Problem and scope
Published model descriptions use an inline style which the real management shell blocks with style-src self. Preserve literal multiline descriptions through one fixed public stylesheet, without weakening CSP. No session, IAM, API data, DDL, runtime activation or provider changes.

## Contract and acceptance
GET/HEAD /management/app.css serves a built-in UTF-8 CSS constant with the same no-store, CSP, nosniff and framing/method/query validation as existing assets. Unknown assets still delegate unchanged. HTML links the exact stylesheet. Description nodes use a fixed class, never user-derived styles or HTML. CSP remains free of unsafe-inline/eval.

## Tests first
Assert CSS GET/HEAD and bound Node serving, method/query/framing rejection without application invocation, linked stylesheet and safe class-only description rendering. Confirm failure on current source before implementing. Native-browser evidence uses the real shell and is separate from synthetic DOM or installed login.

## Implementation sequence
1. Write regression assertions and record RED.
2. Add fixed CSS route/link and replace inline style with fixed class.
3. Run related browser/catalog/build tests, typecheck, lint, document/schema checks and full check; request independent review.

## Risks and unresolved decisions
The extra public asset discloses no private data. Callers embedding renderers outside this shell own their stylesheet. Independently deployed old HTML is not assumed upgraded. No production deployment or whole product acceptance is claimed. No authority decisions change.
