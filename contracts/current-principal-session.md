# Caller-owned Account session lifetime

mountSessionCurrentPrincipal(root, options?) starts unauthenticated. authorize({request, expiresAt}) accepts only a trusted existing request and absolute epoch-millisecond deadline, not browser input. clear() is required on logout or identity changes; replacement authorize first removes the previous identity. dispose is terminal. Known expiry clears private identity and cancels requests; response delivery rechecks time through EOF so missed timers cannot reveal late identity. 401/403 terminate the grant. Invalid time or scheduling fails closed. No credentials are obtained or stored and no session, permission, public navigation or DDL is activated.

This is not administrator login acceptance. Company IdP, CSRF/BFF ownership and installed TLS/storage remain separate gates. Local signed synthetic JWT/embedded PostgreSQL evidence proves only this composition.
