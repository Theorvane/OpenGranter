# Token-management operation snapshots

The internal PostgreSQL service captures its validated actor ID, request ID, target/credential ID, and expiry before asynchronous actor resolution. The coordinator captures operation fields and a known-field actor snapshot before any asynchronous owner lookup or decision audit.

Actor snapshots retain ID, active state, statements (effect/actions/resources), and evaluated policy versions (ID/version). Objects and nested arrays/records are immutable, and extra runtime fields are discarded. Decision events given to the audit port are immutable. Original caller objects remain mutable and later calls inspect their current values.

Owner lookup, policy evaluation, decision attribution, and credential mutation use the captured values. Updates to caller objects during callbacks cannot alter this operation's destination, expiry, identity, or evaluated policy versions. Initial default/explicit Deny and inactive state remain effective. Audit-port exceptions, including attempts to mutate frozen data, use the existing safe unavailable contract and block mutation.

This is an in-process operation snapshot guarantee. The service still reloads persisted IAM state for each call; changes after a DB snapshot read are not revalidated, and no transaction spans all reads/audits/mutations. Existing success/denial/failure ordering and credential lifecycle behavior remain unchanged.
