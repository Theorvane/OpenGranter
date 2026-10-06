# OpenCode conformance

OpenCode 1.18.5 is the first named external application used for a bounded,
reproducible conformance probe. This selection can change without changing the
product contract and does not make OpenCode the only required application.

## Connection configuration

Use a custom `@ai-sdk/openai-compatible` provider. Register model aliases explicitly
from the administrator's approved catalog; the configured models list is not a
claim that OpenCode automatically fetches `GET models` from the gateway.

```json
{
  "model": "opengranter/chat",
  "small_model": "opengranter/chat",
  "enabled_providers": ["opengranter"],
  "provider": {
    "opengranter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenGranter",
      "options": {
        "baseURL": "https://gateway.example/api/v1",
        "apiKey": "{env:OPENGRANTER_PROXY_TOKEN}"
      },
      "models": {
        "chat": { "name": "Approved alias", "limit": { "context": 32000, "output": 1000 } }
      }
    }
  }
}
```

Replace the example base URL and alias with the administrator's deployment values.
Supply the proxy token through the environment; never use a provider API key here.
The custom provider uses Chat Completions. Both `/v1` and `/api/v1` bases are covered.
These context/output values belong to the local fixture, not advertised limits for
all deployed models. Review the actual model's approved configuration.

Sources: [custom providers](https://opencode.ai/docs/providers/#custom-provider),
[custom config path and environment references](https://opencode.ai/docs/config/),
[headless CLI](https://opencode.ai/docs/cli/). Local behavior is tested against the
exact installed version rather than inferred from changing documentation.

## Local verification

Install OpenCode 1.18.5 independently, then run:

```sh
npm run compatibility:opencode -- /absolute/path/to/opencode
```

The command fails explicitly if the binary is absent or its version differs. It
creates fresh temporary config/data/cache/state/work directories, passes a whitelist
of environment variables, disables external skills, project config, updates,
model fetching and plugins, and uses `run --pure --format json`. Text, Deny and disconnect probes deny all tools;
the tool probe allows only reading its single project-relative fixture-file path and denies
all other tools/paths.
HOME is preserved; no user configuration or credentials are written. Each child
has a 30-second timeout (five seconds for the intentional disconnect probe) and a one-MiB combined-output cap. Temporary files and the
loopback server are removed on success or failure. Child failure messages omit
stderr, paths and request content.

The real gateway authenticates a fixture proxy token, evaluates the approved
model/provider route and limits, invokes fixed-host mocked delegated OpenRouter or registered direct OpenAI/Anthropic/Gemini transports,
and records usage/audit before successful completion. No real provider, real
secret or external model is involved. The command verifies registered model
selection, rendered text, actual streamed read-function assembly and execution,
correlated tool-result continuation, fresh IAM/limit checks and completed usage on
both bases and both route kinds. The current default command runs 98 probes; the image subset and native/signature subsets are described below. It also verifies explicit model/provider Deny and upstream cancellation
with failed possibly-billed/missing-usage accounting after child termination.
OpenCode emits an APIError event with status 403 and exit code 1 on these Deny
responses; the probe checks both rather than inferring success from iterator/exit
completion. Diagnostic events remain local in-memory conformance data, never
operational gateway metadata. Default CI tests the
process/config helper and both route-kind socket fixtures without requiring a globally installed client; this explicit
client command is a separate recorded conformance gate.

Interactive cancellation actions, retry/error variants, richer/custom tools, broader native capabilities,
other application versions/configurations and complete #116 certification remain open.

The runner also requires Git and initializes an empty temporary project for exact
project-relative read matching. The read permission map denies every path except
the literal fixture.txt. The temporary project is removed with the other fixtures.

## Managed native scope

OpenCode 1.18.5 now passes the same five modes through managed OpenAI routes on
both bases: rendered text, actual read-function/result continuation, model Deny,
provider Deny and process-termination cancellation with billed/missing accounting.
Native response fixtures use ordinary usage:null and final empty-choice usage;
requests use captured registered models and forced include_usage. The native
model fixture ID is exact; this does not establish automatic model snapshot
equivalence, live provider conformance or other named-client versions.

See [plan](plans/390-opencode-managed-streams.md) and
[contract](../contracts/opencode-managed-streams.md).

## Local PNG attachment conformance

The default command now runs 98 isolated probes: the existing fifty text/tool/security/signature cases and 48 image cases (four route/provider registrations × two bases × six modes). Image cases explicitly add this fixture model metadata:

```json
{ "modalities": { "input": ["text", "image"], "output": ["text"] } }
```

Only enable image input for an administrator-approved image-capable alias. These local settings are fixture capabilities, not automatic catalog discovery or proof that a live model accepts images. OpenCode defaults custom-model image input to false; attachment metadata alone does not enable it.

Reproduce only the image subset with:

```sh
npm run compatibility:opencode -- /absolute/path/to/opencode --images-only
```

The runner uses run --pure --format json --model opengranter/chat followed by the positional prompt and then --file with the absolute temporary fixture.png path. Put the prompt before --file because the file option accepts multiple values. The client decodes the valid one-pixel PNG locally and sends a data:image/png;base64 URL with detail omitted; no remote media is fetched. OpenAI/delegated bodies retain that URL, Anthropic receives a base64 PNG source and Gemini receives inlineData. Image probes supply --title with a fixed fixture title, suppress automatic title generation, and require exactly one image on every captured request and tool-result continuation; an auxiliary call cannot satisfy image evidence.

Image text/function probes render the fixed response and execute only the separately allowed fixture.txt read. Explicit attachment preprocessing is performed by the client independently of model tool permissions; it does not allow model-invoked reads of fixture.png. Initial model/provider and fresh follow-up Deny plus five-second process-disconnect accounting retain the existing controls. Image bytes, file paths and request content remain outside operational records. The two configured/default signed-Google measurements remain separate; signed-image combinations are not covered.

The exact image payload/MIME is measured through mocked transports, not live vision inference. Other image formats/sizes/versions, remote input, supplied native detail, image caching/output and complete #116 remain open. See [plan](plans/470-opencode-inline-images.md) and [contract](../contracts/opencode-inline-images.md). Versioned behavior sources: [CLI](https://github.com/anomalyco/opencode/blob/v1.18.5/packages/opencode/src/cli/cmd/run.ts), [model modalities](https://github.com/anomalyco/opencode/blob/v1.18.5/packages/opencode/src/provider/provider.ts) and [image decoder](https://github.com/anomalyco/opencode/blob/v1.18.5/packages/opencode/src/image/image.ts).

OpenCode 1.18.5 automatically sends X-Session-Id for this custom provider; there is no supported JSON setting to remove it under --pure. OpenGranter validates the selected identifier early but applies header-only fallback exclusively to delegated OpenRouter. Managed native bodies omit header-derived session_id, while supplied body values remain unsupported. The actual client configuration is unchanged; no plugin or provider-ID workaround is needed. See [versioned request headers](https://github.com/anomalyco/opencode/blob/v1.18.5/packages/opencode/src/session/llm/request.ts#L173).
