# History cache safety

Every response on the exact /v1/audit and /v1/usage paths must carry Cache-Control: no-store, independent of method, query, authentication, authorization, reader availability or mandatory-audit result. JSON/CSV bodies, statuses, cursor headers, permissions and mandatory-audit ordering remain unchanged. The Node transport also enforces this for unexpected handler failures and supplied fallback responses. No new route or /api alias is supported. Other routes retain their existing policies.
