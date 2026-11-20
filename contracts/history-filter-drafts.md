# Unapplied history filter drafts (#642)

- Usage and Audit keep separate in-memory drafts for this mount. Input events must not send a request or alter the applied principal/model/time/request/page-size filters or cursor path.
- A live status distinguishes edits from the applied query: records, pagination and CSV still use applied filters until Apply. Returning every visible value to its applied representation removes the status, including blank values.
- Rerendering after tab switching, refreshing, paging, CSV progress or a pending read preserves edits. This is not background authority or a persistent saved search. Tab entry still performs the existing fresh authorization.
- Apply validates exact identifiers and numeric bounds through the existing clients. Reset restores the initial target; neither typing nor switching tabs broadens an account deep link. An explicit request investigation discards unapplied destination edits and displays the applied request intersection.
- Rerender clears detached input values and retires their input listeners. Denial, sign-out and disposal clear in-memory draft/applied state. A stale event cannot restore or send private edits.
- No new API/session/schema/retention/activation. Browser memory does not prove company SSO, installed deployment, database or provider acceptance.

### Focus continuity during history responses (#642)
When an asynchronous history notification replaces the current focused filter on the same tab, preserve its unapplied draft, keyboard focus and text selection (including backward selections). Do not steal focus from external controls or restore filters across tab changes, denial or disposal. Detached private inputs still clear. This is local presentation continuity, not saved-search persistence or authority. See [draft preservation plan](../docs/plans/642-history-draft-preservation.md).

### Page-local CSV delivery feedback (#642)
Browser-adapter failures remain generic and retryable, but expire when a new JSON page read starts (including tab re-entry) or a new CSV attempt begins. A successful adapter dispatch announces only: CSV download requested. Check your browser; file save is not confirmed. It must not claim file-save completion. Feedback belongs to the current render; synchronous navigation/disposal inside the adapter cannot publish it into a replacement view. Denial still removes private content. No API, authority or activation changes.

### Explicit UTC history ranges (#642)
From (inclusive) and To (exclusive) accept canonical nonnegative integer Unix milliseconds or strict YYYY-MM-DDTHH:mm:ss[.sss]Z UTC timestamps. No local timezone/offset inference, whitespace trimming or invalid calendar normalization. Only exact milliseconds cross the existing API. Equivalent UTC/millisecond drafts are not unapplied edits. Existing time-range validation, principal/model/request scope, pagination, CSV, fresh IAM and read audits are unchanged. See [UTC range plan](../docs/plans/642-history-utc-range.md).
