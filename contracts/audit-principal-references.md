# Exact Unicode audit principal references

Refs #637, #642. Existing proxy-authenticated GET /v1/audit accepts exact principal_id references containing Unicode, including Korean and supplementary characters. Principal actor/target metadata in the existing gateway audit store and its reader use the same predicate: nonblank string, at most 256 UTF-16 code units, no Unicode Cc characters. Strings are not trimmed, case-folded or Unicode-normalized; composed and decomposed IDs remain distinct.

Only principal references change. Request IDs, credential IDs, policy references, models, providers and other audit metadata retain their existing restricted identifier grammar. Unknown/duplicate query fields, query ranges, cursor bounds, row projection and CSV escaping remain unchanged.

Target-specific audit:Read, fresh authentication/IAM, explicit Deny, parameterized SQL and mandatory awaited audit still apply. An explicit principal query supplies no authority. Failed audit must suppress both JSON and CSV results. Invalid principal references fail before audit history storage reads; invalid store actor/target references fail before insertion.

This fixes a real parser and durable-projection mismatch for existing Unicode identities. It adds no SSO audit API, browser session, public entry, runtime activation, schema migration or permission. PGlite and loopback HTTP evidence are not installed PostgreSQL, company IdP or native-browser acceptance.

Plan: [exact audit principal filters](../docs/plans/642-audit-unicode-principal.md).
