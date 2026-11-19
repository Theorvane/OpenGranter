# Usage request audit investigation

An authorized Usage row offers View audit for this request. The action switches to Audit and freshly loads the exact request_id intersected with Audit applied principal/model/time filters, clearing its cursor and drafts. Usage visibility never confers audit:Read or supplies the Audit target. Invalid applied Audit filters stay invalid rather than broadening the query.

Existing fresh signed-bearer authentication, IAM/Deny and mandatory durable access audit remain authoritative. Loading removes previous rows. Empty results mean no visible audit records in this filtered page, not complete audit history or proof that a request was never executed. Errors are generic; denial clears both histories. Detached or disposed controls cannot issue requests. No new routes, permissions, sessions, provider calls or activation.

Plan: [642](../docs/plans/642-usage-audit-investigation.md).
