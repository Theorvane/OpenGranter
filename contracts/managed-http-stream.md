# Controlled managed HTTP stream delivery

Reuse the existing single-pending-frame HTTP controller for managed text streams. Preserve awaited delivery, zero high-water mark, cancellation, metadata-only interruption audit and post-accounting final frame gates. Project managed provider/credential/usage/audit failures safely for OpenAI and OpenRouter formats; public gateway activation is a subsequent increment.

This bounded internal stage preserves fixed destinations and captured scope.
It does not activate public managed streams or claim full #116 compatibility.
