# Complete token-management actor snapshots (#637 / #640)

## 1. Problem and scope
Array.every skips missing actor array positions. Sparse evaluated policy versions can reach allowed audit and token mutation with incomplete attribution. Sparse statements can escape as raw TypeErrors. Close this existing authorization/audit integrity gap, not the undecided session or public simulator boundary.

## 2. Contract and design
Require own, present, valid entries at every index of statements, each action/resource array, and policyVersions before owner lookup, audit or mutation. Reject inherited numeric entries masking holes. Preserve dense empty arrays, Deny precedence, immutable snapshots and known-field projection. No permission, endpoint, schema, listener or provider changes.

## 3. Acceptance and TDD
First add issue/revoke cases for leading/interior/trailing holes in all four arrays and inherited numeric entries. Require fixed InvalidTokenManagementInput and zero port calls. Dense Allow still audits before mutation; existing empty/inactive/explicit Deny cases remain. Record RED then GREEN. Exercise the real owned loopback HTTP adapter with the coordinator behind its ports, separately from installed PostgreSQL/IdP certification.

## 4. Verification and delivery
Run targeted coordinator/service/HTTP tests serially, full TypeScript/lint, planning/contracts and compatibility checks. Publish isolated main-based PR and request independent exact-head review. Merge requires all required CI and valid formal approval. Rollback is code revert. No production or paid calls.
