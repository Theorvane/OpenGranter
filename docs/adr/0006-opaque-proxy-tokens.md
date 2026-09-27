# Use opaque proxy tokens with durable revocation

OpenGranter issues random opaque bearer tokens and checks a stored digest on every gateway call. A self-contained signed token would reduce database reads, but immediate revocation and per-credential attribution are central to the internal IAM boundary. The token format is versioned so later formats can be introduced without treating a provider credential or SSO session as a proxy token.
