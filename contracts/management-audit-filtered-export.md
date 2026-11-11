# Filtered audit CSV user action

exportFilteredAuditCsv(request, currentPrincipalId, filters, {signal,maxPages?,maxBytes?}) uses existing /management/v1/audit?format=csv authorization and mandatory audit for EVERY page. Principal validates client context only; UI filters grant no authority. Starts at first captured page, preserves server cursors exactly and CSV escaping/multiline/redaction. Default50, hard100 pages; hard8MiB UTF8. Limit exhaustion is limit_exceeded, never truncated success. All errors expose no partial data. Invalid principal/options return invalid_query before transport.

Caller must abort on logout/expiry/policy/principal changes/navigation/dispose, clear completed data and revoke download URLs. Terminal traversal is neither a stable database snapshot nor tamper-resistant evidence. No retention/session/runtime/DDL activation. UI action separate from current-page CSV.
