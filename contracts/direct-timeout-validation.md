# Direct-provider timeout validation

Each direct OpenAI, Anthropic, or Gemini attempt captures and validates `timeoutMs` before credential resolution. Undefined uses 30,000 ms. A supplied value must be a safe integer in the inclusive range 1 through 2,147,483,647 ms, matching delegated adapter bounds.

Invalid configuration throws the existing safe `DirectProviderFailure` with category other, responseStarted false, and possiblyBilled false. It resolves no secret and makes no fetch. Managed routing does not retry an other-category failure; its existing metadata audit records the failed non-billable attempt without creating a billable usage record.

After validation, changes to the source configuration during asynchronous secret lookup cannot change this attempt's duration. Subsequent attempts validate the current configured value. Valid configuration still uses the existing upstream signal, fixed URLs, secret handling, HTTP error classification, and pre-response timeout behavior. This adds no global request deadline or deployment configuration mechanism.
