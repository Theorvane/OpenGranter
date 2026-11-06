# Catalog read cancellation (#639)

Loading list/detail views expose Cancel catalog request. Activation aborts the pending client read and removes loading/private content. A dedicated cancelled status offers Back to models. The trusted grant deadline is unchanged; retry still uses fresh server authentication, IAM and mandatory audit. Cancellation does not undo a server read or its audit. No previous detail is restored.

Cancellation outside a current loading read is inert. Every SSO catalog DOM action is bound to its rendered snapshot, including list/detail navigation, cancel and usage navigation. Renewed grants, newer reads, expiry, logout and disposal invalidate detached controls. Late read completion cannot replace the cancelled or newer view.
