# Readable history timestamps (#642)

The existing authorized Usage/Audit JSON pages feed both list summaries and details. Render occurredAt as explicit ISO UTC with millisecond precision, not browser-local time. Retain exact Unix milliseconds in details. Zero is epoch, never missing. Valid nonnegative safe-integer timestamps outside Date range display their exact numeric value with UTC unavailable; they do not invalidate the row. No raw objects are serialized or new metadata exposed.

API/CSV timestamp fields, query bounds, authorization, durable audit, cursor order and download behavior are unchanged. Error/denial refreshes remove previous authorized rows and their timestamps through the existing workspace lifecycle. No session, DDL, activation, installed deployment or real-provider assertion. Public-mount regressions: test/history-readable-time.test.ts.
