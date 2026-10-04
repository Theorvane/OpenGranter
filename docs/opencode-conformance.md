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
model/provider route and limits, invokes a fixed-host mocked delegated transport,
and records usage/audit before successful completion. No real provider, real
secret or external model is involved. The command verifies registered model
selection, rendered text, actual streamed read-function assembly and execution,
correlated tool-result continuation, fresh IAM/limit checks and completed usage on
both bases. It also verifies explicit model/provider Deny and upstream cancellation
with failed possibly-billed/missing-usage accounting after child termination.
OpenCode emits an APIError event with status 403 and exit code 1 on these Deny
responses; the probe checks both rather than inferring success from iterator/exit
completion. Diagnostic events remain local in-memory conformance data, never
operational gateway metadata. Default CI tests the
process/config helper without requiring a globally installed client; this explicit
client command is a separate recorded conformance gate.

Interactive cancellation actions, retry/error variants, richer tools, direct streaming,
other application versions/configurations and complete #116 certification remain open.

The runner also requires Git and initializes an empty temporary project for exact
project-relative read matching. The read permission map denies every path except
the literal fixture.txt. The temporary project is removed with the other fixtures.
