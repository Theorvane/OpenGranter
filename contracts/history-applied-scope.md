# Applied history query scope

Refs #642 and #637. For ready/empty pages the public history mount displays the active applied principal mode, exact model/request restrictions, explicit inclusive/exclusive UTC time bounds and configured page-size setting. Omitted principal means the signed-in principal, consistent with canonical server readers; it never means all principals. Omitted model/request/time restrictions are labelled absent, not unrestricted authority. Omitted limit is labelled Server default, never inferred from a short page.

The summary uses per-view applied filters, not drafts, records, cursor contents or sibling filters. CSV keeps the same existing applied query. Loading, invalid, failed, cancelled, denied and disposed views expose no summary of previously authorized scope. Reset restores the exact mount target. Text uses literal DOM textContent, never HTML. Query restrictions do not describe effective permissions, complete history, invoice totals or guaranteed export saves.

No endpoint, policy, audit, session, schema, runtime activation or deployment behavior changes. Fresh server authorization, mandatory audit and existing JSON/CSV validation remain authoritative. Tests through synthetic local transport/native Chromium are not installed IdP/PostgreSQL/provider acceptance.
