# Audit current-page refresh and recovery (#642)

1. Scope: add an explicit current-page refresh/retry to the existing authorized audit UI. Preserve submitted filters, exact cursor and previous-page navigation on transient read/export errors. Do not activate sessions or change API/IAM/audit contracts.
2. Contract: refresh performs a new authorized read with captured filters, never unsubmitted drafts; clear old detail/CSV immediately. No parallel refresh while loading/exporting. Invalid filters require form correction, not a blind retry. Deny, logout, expiry and disposal prohibit retry and clear private state.
3. RED: mounted UI lacks a refresh control; workspace lacks a captured-page refresh operation. Test retry on page two after 503, retained back-stack, busy/stale controls, expiry and Deny.
4. GREEN: implement the smallest workspace operation and accessible button. Exercise the existing real SQL-backed HTTP handler with a transient required-audit failure and recovery, not only mocked JSON.
5. Validation: targeted regression, full typecheck/lint and standard CI; local browser evidence distinguished from fixture DOM and installed/real-IdP acceptance. Exact-head formal approval and all required CI are mandatory before merge.
6. Remaining: browser session contract remains unapproved; no deployment, paid calls, provider or whole-PRD completion claim.
