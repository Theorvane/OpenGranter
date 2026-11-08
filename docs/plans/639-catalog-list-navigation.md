# Catalog list navigation integrity (#639)

1. Reproduce proxy list rows that cannot be opened by the existing detail operation, and duplicate identities in both transport namespaces.
2. Validate every list alias with the same local navigation rules as detail; preserve proxy count/user exclusions and SSO allowance. Reject an ambiguous list atomically, never hide or deduplicate rows.
3. Add RED/GREEN transport and session cases for invalid, duplicate, valid Unicode and exact-case-distinct aliases. No server publication, credential, UI ownership or session activation change.
4. Run focused tests, typecheck, lint and contract checks; require independent exact-head approval and all required CI before merge. Browser/company SSO and installed acceptance are separate gates.
