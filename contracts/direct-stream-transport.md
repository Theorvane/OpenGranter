# Direct OpenAI text-stream transport preparation

Expose an internal fixed-host direct OpenAI text-stream transport. Reuse existing native request controls and administrator output caps; capture approved candidate identity, client alias and complete prepared body before awaiting secrets. Nonstream adapters use the same captured scope. Always request include_usage for internal streams; reject other provider kinds and tool declarations/history before credentials. Support cancellation/deadline while awaiting secrets and fetch without inference retry. Response consumption and public managed streaming follow separately.

This bounded internal stage preserves fixed destinations and captured scope.
It does not activate public managed streams or claim full #116 compatibility.
