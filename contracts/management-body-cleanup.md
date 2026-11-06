# Credential upload rejection cleanup (#640)

Both existing authenticated credential POST handlers must finish a known 400 invalid_request rejection without waiting for the request body's underlying cancellation promise. Oversize bytes, invalid UTF-8 and pre-dispatch abort never reach credential mutation. Cleanup requests cancellation once, observes any rejection and releases the reader lock. Successful complete uploads are not cancelled. Neither cleanup nor client disconnection establishes rollback of an already dispatched write.

Authentication still precedes body consumption. No added upload deadline, retries, authentication bypass, endpoint, listener, schema or runtime activation. A never-finishing valid upload remains subject to the caller's approved server timeouts. This contract does not settle browser sessions or unknown-write reconciliation.
