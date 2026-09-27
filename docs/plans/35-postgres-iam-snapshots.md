# Load IAM Attachment Snapshots from PostgreSQL

## Issue and problem

- Issue: [#35](https://github.com/Theorvane/OpenGranter/issues/35)
- The attachment authenticator accepts a trusted principal/role/policy snapshot, but no durable adapter supplies one. Database-backed IAM evaluation needs a complete, consistent snapshot.

## Scope and expected behavior

- In scope: PostgreSQL tables for principals, roles, versioned policies, direct principal-policy attachments, principal-role assignments, and role-policy attachments; one-statement snapshot loading for one principal; strict parsing into the existing `IdentityAttachmentSnapshot` contract.
- Out of scope: mutation APIs, SSO, admin UI, policy version history, multitenancy, and deployed connection provisioning.
- A nonexistent principal returns no snapshot. Malformed rows, incomplete attachments, duplicate records, and database failures return a fixed safe availability error. An inactive principal remains inactive so the existing authenticator denies before policy resolution.
- The reader never returns provider credentials, proxy tokens, or arbitrary JSONB fields.

## Design

- Store attachment relationships in normalized tables with foreign keys. Load principal, referenced roles, referenced policies, and attachment IDs through one SQL statement using a common target-principal CTE. One statement gives a consistent PostgreSQL MVCC view without assuming a pooled client's separate queries share a transaction.
- Parse each tagged row into allowlisted TypeScript fields. Validate statement effects, nonempty action/resource patterns, and policy versions. The existing `resolvePolicyAttachments` remains the single source of attachment semantics, including explicit Deny precedence.
- Update [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). No ADR is needed for the normalized reader and one-statement consistency choice within the existing IAM model.
- Open decisions: management write API, policy version retention, company SSO, and operational database connection handling.

## TDD plan

- First test a PostgreSQL-backed principal with a direct Allow and role-based provider permission through `createAttachmentAuthenticator`; expect the store module to be absent.
- Add direct Deny precedence, inactive/missing principal, malformed policy JSON, missing references, and database-failure tests. Check the adapter uses one parameterized SQL call and excludes unexpected fields.
- Implement schema and reader, then run focused red/green tests and `npm run check`.

## Delivery

- Commit on `feat/35-postgres-iam-snapshots` with authorized DCO and assistance trailers. Open a ready PR linked to #35 and this plan.
- The read adapter needs management writes and connection provisioning before a deployable identity service exists.
