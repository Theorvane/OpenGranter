# Reconcile compatibility implementation status

## Issue and problem

- Issue: [#232](https://github.com/Theorvane/OpenGranter/issues/232), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Older component sections describe public delegated streaming, cancellation and compatible error projection as pending despite implemented public-boundary regression coverage. Discovery descriptions mix basic catalogs with configured metadata.

## Scope and expected behavior

- Reconcile the compatibility inventory, architecture, acceptance and affected component contracts with existing code/tests. Remove duplicate obsolete status text and distinguish legacy/schema gaps from configured supported subsets.
- Documentation only: no API, authorization, secrets, accounting, audit, schema pin or runtime change. Full compatibility remains a release gate.
- Preserve historical issue plans and component responsibilities. No new requirements, domain terms or ADRs.

## Design

- Check claims against public-boundary tests and link the contracts that integrate each component. A read-only fact audit supports this comparison under the repository planning skills.
- Component-local exclusions stay explicit; gateway-level implemented integration replaces obsolete gateway-level pending claims.
- Final reconciliation follows all twenty-nine functional PR merges, including discovery/paging, the version-15 source pin, sampling/effort controls, scalar/detail reasoning, tier and native-finish metadata. Replay only this issue's documentation commit on the resulting main.

## TDD plan

- Production behavior is unchanged, so no production-code red/green cycle is applicable. Verify claims against existing SDK, streaming, cancellation, refusal and discovery regressions.
- Run planning-document/link/contract checks, git diff --check and the final npm run check. Compare the live source-guard PASS receipt with unchanged pin/checker blobs; do not update the source pin in this documentation change.

## Delivery

- Record the issue/plan, correct contradicted descriptions and open a focused documentation PR with explicit dependencies.
- Evidence: review the merged public HTTP/SDK regressions and recorded red/green checks for discovery snapshots and stream reasoning validation. Reconcile current contracts and the compatibility matrix with bounded runtime support, measured SDK gaps and structural source coverage. Runtime, IAM, secrets, audit, usage and source-pin files remain unchanged. Final validation will be recorded in the PR after the complete check; #116 remains open.
- Risk: describing one compatible subset as full support. Keep unknown usage, direct/tool/rich streams, legacy SDK gaps, metadata freshness and named external-client workflows open.
- Rollback: revert this documentation commit without changing runtime behavior.
