# HTTP client disconnection

The shared Node request bridge gives each Fetch Request a distinct AbortSignal. An interrupted upload or response socket closed before writable completion aborts it, including while the handler is awaiting a result. Completed responses leave it un-aborted. Abort reasons do not contain caller data or infrastructure errors.

Response bodies remain streamed through the existing backpressure-aware pipeline. A downstream loss cancels an active response body; when the handler returns after cancellation, the bridge cancels its unread body without writing a fallback to the closed socket. Lifecycle listeners are removed when handling and delivery finish. A fallback before headers is the existing safe JSON error; after headers, the connection is destroyed without appending JSON.

Handlers and providers must observe the signal to stop work. This contract does not enable client chat streaming, alter authorization, claim delivery acknowledgment, replay inference or implement interruption accounting/audit. Those controls remain separate release gates.
