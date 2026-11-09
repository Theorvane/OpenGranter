# Management audit event inspection (#642)

- Each authorized audit row has a native disclosure with event ID, UTC timestamp, kind, principal, request, credential reference, evaluated policy ID/version pairs and projected metadata.
- Empty policy versions mean no policy versions recorded, not Allow or Deny. No credentials are minted or raw token values retrieved.
- All values are text nodes. Details come only from the existing strict client projection; unexpected raw response fields never appear.
- A new page, failed read, denial, expiry, identity replacement or unmount removes the previous disclosures with the existing workspace. No additional request or permission is implied by opening a disclosure.
- Table headers have column scope and the table identifies its page scope. CSV semantics, server authorization/audit and content-retention decisions are unchanged.
