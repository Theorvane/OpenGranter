# Token management native page exit

The shared token-management panel observes `pagehide` on its owning document's native window when present. Page exit is terminal for this mounted panel, including back/forward-cache navigation: dispose both children, clear owned live/detached secret and input nodes, abort pending client waits, remove the observer and reject retained control actions. No `pageshow` handler reactivates it. A host must mount a fresh panel using approved authority after restoration.

Explicit disposal and fresh 401/403 also remove the observer. A denial boundary is not overwritten by later page events. Non-browser documents with absent/null defaultView retain explicit host-disposal behavior. Independent windows/panels do not dispose each other.

This is display cleanup, not token revocation, server mutation rollback, proof of an uncertain operation's outcome or authentication. Hosts still own logout, known expiry and identity-change disposal. No credentials are written to history, storage, telemetry or a new endpoint by this behavior.

Cases: `test/token-management-pagehide.test.ts` covers success and retained secrets, in-flight cancellation and late response, stale controls, repeated events, denial cleanup, independent lifetimes and non-browser callers.
