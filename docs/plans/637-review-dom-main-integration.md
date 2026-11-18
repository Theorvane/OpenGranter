# Integrate reviewed usage/audit DOM with canonical main (#637)

## Problem and scope
PR #896 predates the merged pure shared projections. Duplicating its server extractions forks validation and exception identity. Integrate existing DOM functionality without new authority or activation.

## Acceptance and contract
Keep canonical main server wrappers, exact shared browser allowlist and canonical-root/transitive checks. Legacy extraction modules forward the same canonical functions and exception constructor. Retain existing DOM exports, loading/empty/error/denial, pagination, CSV callback and disposal. No session, IAM, formats, deployment or paid-call decisions.

## TDD and implementation
1. Merge main into existing PR in isolated worktree; preserve canonical shared implementations in six conflicts.
2. RED: legacy exports must equal canonical functions and exception constructor.
3. Forward duplicate extraction modules; GREEN identity and build/DOM/HTTP regressions. Run npm run check.
4. Update existing PR #896 only; require fresh exact-head CI and independent formal approval. Prior approval becomes stale.

## Risks and rollback
Legacy wrappers remain server compatibility paths, not additions to browser allowlist. Browser imports must reject them. Revert integration to roll back. Native browser/installed IdP/provider acceptance remains separate.
