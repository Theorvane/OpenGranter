# User cancellation of canonical history loading

Both createUsageReview and createAuditReview expose cancelLoad(). It is a no-op unless the review is unblocked and loading. It retires pending work and aborts the transport, then publishes cancelled with no rows, pagination actions or export. The attempted page (including opaque cursor) and copied filters survive solely for explicit retry. No automatic retry or sibling cancellation occurs. Cancellation does not grant authority or resurrect a terminal/disposed workspace.

Late success, failure and 401/403 on the aborted request cannot replace current state or terminate the shared epoch. A fresh retry denial still clears both histories. Cancellation during the loading observer must prevent dispatch. Teardown is terminal and suppresses any late continuation. cancelLoad does not cancel CSV on an already loaded page; that is a separate operation. The DOM exposes Cancel loading only during loading, with the existing Retry action after cancellation.

This is controller/DOM adapter functionality on an already-authorized request port, not login, IdP, installed PostgreSQL, provider, or browser/deployed acceptance.
