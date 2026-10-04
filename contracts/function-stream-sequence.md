# Delegated function stream sequence preparation

OpenRouterFunctionStreamSequence consumes only already validated internal #344
function events. Response ID and local model alias stay stable. Open deltas precede
one terminal event, then one usage event with null or matching finish, then DONE.
Missing, reordered or extra events permanently invalidate the instance. Upstream
errors in any active phase yield a fixed failed, possibly-billed outcome; invalid
sequences throw the shared fixed sequence failure with possiblyBilled:true.

Call arguments append exactly by index without parsing or execution. ID, function
name and type are stable metadata: repeated equal values are allowed; conflicting
values reject. Fields may arrive late. Completed calls require supplied function
type, nonempty unique IDs/names, an explicitly supplied argument string (empty is
valid), and dense indices zero through count-minus-one, up to 128. Nonempty calls
require tool_calls finish; that finish without calls rejects. Substantive refusal
anywhere in a call-bearing response rejects, including across chunks. Ordinary
text/refusal/reasoning outcomes follow supported ordinary finish behavior.

The aggregate retained ID/name/argument size cannot exceed 1,048,576 UTF-16 units.
Each unique ID/name is charged once; argument fragments accumulate against the
shared budget across all calls. This is an explicit local memory subset, not an
official token/byte/provider limit. Full JSON/schema-validity or dispatch safety of
arguments is not inferred. Stable metadata, dense indices and completeness are
also local sequence constraints beyond the optional fragment schema.

Private fields prevent automatic JSON serialization of partial calls, text,
reasoning or refusal. No ordinary response transcript is stored. Call state clears
on upstream error, sequence failure and finalization. Success returns deeply frozen
assembled calls as explicitly response-bearing data only after terminal/usage/DONE.
They must never enter operational logs, errors, audit or usage metadata. The usage
snapshot retains missing/invalid categories without fabricating counters, and final
metadata comes from the usage event as in the established text sequence.

The original text sequence, provider transports, HTTP tool-stream guards, IAM,
limits, persistence and accounting are unchanged. This class does not deliver SSE,
execute functions, resolve credentials or record usage. Consumer/transport/client
SSE/cancellation/accounting integration and complete external-tool workflows are
still required; #116 and the transitive tool schema drift gate remain open.

Source for stable Chat Completions metadata and appending argument fragments:
[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).
See [plan](../docs/plans/346-function-stream-sequence.md) and
[fragment contract](function-stream-chunks.md).
