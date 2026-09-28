# Gateway authenticated principal snapshots

The HTTP handler captures an immutable known-field principal projection immediately after authentication, before body/catalog/route awaits. Identity, active state, credential, statements (including action/resource arrays), and evaluated policy versions belong to the same request context.

Source updates during asynchronous work cannot widen the request permissions or change the limit owner or attribution. Original source objects remain mutable; later requests capture then-current authenticator results. Unknown fields are omitted.

Snapshot construction failure follows safe authentication-unavailable handling; required failure audit remains mandatory. Existing default/explicit Deny and inactive authentication behavior remain in force. This introduces no policy revalidation transaction or SSO mechanism.
