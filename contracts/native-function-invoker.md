# Registered OpenAI function stream invoker

Introduce an explicit function-stream mode on captured direct request transport. Reuse validated OpenAI tools/choice/parallel controls and correlated result history, fixed registered host, output caps, immutable pre-secret scope/body, timeout and cancellation. Compose native function response validation. Preserve text-only rejection and fail unsupported kinds/invalid controls before keys. No inference retry in the adapter.

This bounded internal stage preserves fixed destinations and captured scope.
Managed text is already activated; this stage does not activate managed function streams or claim full #116 compatibility.
