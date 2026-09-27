# Principal and Role Policy Attachments

## Issue and problem

- Issue: [#5](https://github.com/Theorvane/OpenGranter/issues/5)
- The current policy evaluator accepts statements already flattened by a caller. It does not represent direct principal policies or policies inherited through roles, so a future gateway or simulator could resolve those differently.
- Internal developers and service accounts need the same decision semantics.

## Scope and expected behavior

- Add a pure authorization function that accepts a trusted snapshot of one principal, role assignments, and versioned policy records, then calls the existing evaluator.
- Combine direct and inherited policy statements. A matching Deny overrides all Allows; no matching Allow is denied. Inactive principals are denied before attachment resolution.
- Treat a referenced role or policy with no record, or more than one record with the same ID, as an unresolved attachment and deny the whole request. Do not use a partial Allow.
- Return the IDs and versions of resolved policies for future audit attribution. Do not return policy content or secrets in the result.
- Support human and service principals identically for policy evaluation. This slice does not choose SSO, proxy-token shape, persistence, or HTTP endpoints.

## Design

- Model a **policy attachment** as a policy ID directly on a principal or on an assigned role. The role ID list is the principal's current assignment snapshot. Removing an assignment changes the next decision once the caller supplies the updated snapshot.
- Resolve each referenced ID exactly once. A policy attached both directly and through a role contributes one statement set and one policy-version reference.
- Reuse `evaluate` for the final decision so simulation and later gateway use the same rules. Return `unresolved-attachment` only for an invalid trusted snapshot; keep existing evaluator reasons for valid snapshots.
- Extend `CONTEXT.md`, [acceptance scenarios](../acceptance.md), and an executable attachment contract. No new ADR is needed because this is a reversible representation of already agreed policy semantics.
- Authentication and credential revocation precede this function. The caller must not treat a simulated Allow as proof of an authenticated request.

## TDD plan

- Add contract cases and a test before implementation. Confirm the test fails because the attachment evaluator is absent.
- Cover direct Allow, inherited Allow, cross-source Deny, multiple roles, default Deny, inactive principal, missing and duplicate referenced IDs, overlapping attachments, and provider permission.
- Implement the minimum resolver and call the existing evaluator. Refactor with tests green.
- Run the focused contract test, then `npm run check` and `git diff --check`.

## Delivery

- Add the contract, pure TypeScript evaluator, and tests in issue #5's branch.
- Record red/green evidence and link this plan in the pull request.
- Risk: This function is not an HTTP authorization boundary until authentication and trusted snapshot loading are integrated. That integration needs separate issues.
