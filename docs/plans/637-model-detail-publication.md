# Published model detail display (#637, #641)

1. Preserve the approved read-only SSO catalog contract and frontend ownership. Login/session acquisition remains blocked on its approved contract; this slice does not replace that release gate.
2. Add source and compiled public-mount tests that require published description, modalities, parameters, context bounds and exact base-price strings in model details. Distinguish absent publication, explicit unknown and zero. Run meaningful RED before production changes.
3. Render only existing decoded public fields as inert text with explicit descriptive/non-billing caveats. Keep basic identity fields and existing navigation. Do not add API, policy, credential, session, database or runtime behavior.
4. Exercise signed test SSO, loopback Node HTTP, migrated PGlite and durable audit through the actual public mount for both source and compiled modules. Verify current Deny and removed identity clear details and audit never contains descriptive metadata.
5. Run focused tests, typecheck, lint, planning and offline compatibility checks. Open a draft stacked PR; require exact-HEAD CI and independent formal approval before merge. Native browser, company SSO, installed PostgreSQL and paid-provider acceptance remain separate and unverified.
