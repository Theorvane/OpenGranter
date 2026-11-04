# Discarded management catalog bodies

Refs #637/#639 and [plan](../docs/plans/639-catalog-error-body.md).

Catalog reads best-effort cancel unread bodies for non-200 responses and late responses superseded by navigation, session teardown or the read deadline. Cancellation is neither awaited nor parsed; rejecting, stalled or unavailable cleanup must not change existing safe states or expose private error text. No automatic retry or provider call is added. Successful 200 reads retain normal decoding. Server authorization and audit are unchanged; cancellation does not roll back server work.

This is transport resource cleanup, not a response-size guarantee, server timeout, browser login implementation or deployed acceptance result.
