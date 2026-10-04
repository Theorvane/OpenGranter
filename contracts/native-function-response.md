# Native OpenAI function stream response validation

Consume native OpenAI indexed function deltas through bounded framing and the existing function sequence. Preserve exact model scope and stable response identity/timestamp. Ordinary usage:null is a delta extension, final empty-choice usage is required before DONE. Completed calls remain response content; rich/custom/deprecated fields fail safely. Classify opened-stream failures as possibly billed and cancel body on delivery failure or abort.

This bounded internal stage preserves fixed destinations and captured scope.
Managed text is already activated; this stage does not activate managed function streams or claim full #116 compatibility.
