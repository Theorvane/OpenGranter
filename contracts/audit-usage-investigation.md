# Audit request usage investigation

An authorized Audit row offers View usage for this request. It opens the existing Usage review and performs a fresh GET with its exact request_id intersected with Usage applied principal/model/time restrictions; cursor is cleared. Audit principal/model/time and unsubmitted drafts are not copied. Self Usage remains self scoped. Explicit Usage targets retain usage:ReadAll requirements.

A stale row control cannot trigger transport after refresh, tab navigation or disposal. Existing mandatory audit and fresh IAM checks remain server enforced. Loading replaces old rows; empty results mean only no visible usage in this query, not proof of no provider call or bill. Generic failure, denial and authentication states retain existing handling. No mutation, credentials, provider call, session acquisition or deployment activation.

Plan: [642](../docs/plans/642-audit-usage-investigation.md).
