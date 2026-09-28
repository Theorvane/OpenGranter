# OpenRouter timeout snapshot

Each OpenRouter chat attempt captures the configured timeout before asynchronous secret resolution. Undefined uses the existing 30,000-ms default; supplied durations must be safe integers from 1 through 2,147,483,647 ms inclusive.

The upstream signal uses this captured value. Changes to the source configuration during secret lookup affect subsequent calls only; each subsequent call validates its current value before credential access. Initially invalid settings retain the existing sanitized configuration failure with responseStarted false and possiblyBilled false, without secret or fetch work.

Provider bounds, response validation, credential and upstream failure metadata, and timeout classification are unchanged. This contract adds no global deadline or deployment configuration/reload mechanism.
