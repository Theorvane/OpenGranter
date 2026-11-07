# Model detail to usage drilldown (#642)

1. Add an optional detail action to the existing SSO catalog app and existing workspace. Navigate to the existing usage app with the exact published alias as its initial model filter; never translate upstream identifiers or infer read permission from catalog visibility.
2. Preserve current server SSO/IAM/audit and CSV/filter behavior. Drop pagination and prior filters on drilldown; ordinary navigation starts unfiltered. No entry/session/runtime/schema or policy changes.
3. Establish RED/GREEN for exact alias transport, CSV propagation, fresh denial and detached controls after navigation, renewal, expiry, pagehide and disposal. Exercise actual signed SSO loopback HTTP and embedded SQL with mandatory audit, separately from native-browser or installed acceptance.
4. Run focused tests, typecheck, lint, planning and build checks. Require exact-head CI and independent formal approval before merge.
