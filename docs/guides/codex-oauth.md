# Codex subscription OAuth: operator authentication

This is an **authentication-only first slice** (#635), not a working OpenGranter GPT provider. The existing direct OpenAI registration still uses a Platform API key and Chat Completions; never insert Codex credentials there. No model discovery, entitlement, chat, streaming, tool-call, usage or restart acceptance has been established by signing in.

## Requirements and setup

- POSIX host, supported Node.js 22 toolchain, and an administrator-installed official [Codex CLI](https://developers.openai.com/codex/cli). This command does not download or execute packages on demand. Select and maintain a trusted CLI version as an operator; protocol/options may change.
- A ChatGPT account/workspace eligible for Codex and device-code login. Device authorization may need enabling in account security settings. Subscription availability and limits are determined by OpenAI; no unlimited-use claim is made.
- Run on the trusted host/account that will own the isolated credentials. Do not use a shared/public terminal or capture the login terminal in logs. Authorize only a login you initiated, in OpenAI's own browser UI.

```sh
# Create a private parent owned by the operator; use a real path, not a symlink.
mkdir -p "$HOME/.local/share/opengranter"
chmod 700 "$HOME/.local/share/opengranter"
export OPENGRANTER_CODEX_BIN="$(command -v codex)"
export OPENGRANTER_CODEX_HOME="$HOME/.local/share/opengranter/codex-subscription"
npm run codex:auth -- login
npm run codex:auth -- status
npm run codex:auth -- logout
```

Both paths must be absolute. The home must be canonical, owned by the operator, and mode 0700; the default personal `$HOME/.codex` is rejected. Login creates only the final directory (the parent must exist); status/logout require it to exist. This command never changes permissions of an existing directory.

The wrapper runs the selected executable without a shell, in a separate process group. It passes `login --device-auth` and forces `cli_auth_credentials_store="file"` and `forced_login_method="chatgpt"`. Only login inherits the terminal for the official URL/code and prompts. Complete authorization directly in the browser; do not paste passwords, OAuth tokens or auth.json into chat, issues or API-key fields. Tests never perform real authorization.

## Security and lifecycle

- `HOME`, `CODEX_HOME` and XDG locations are isolated. Only PATH and terminal/locale variables are inherited. Provider API keys, proxy credentials, alternate Codex config, proxy/custom-CA environment and debugging flags are not forwarded. Hosts requiring custom networking need a separately reviewed configuration; do not disable certificate checks.
- The official CLI owns credential persistence and any future refresh during supported CLI use. This wrapper never reads, returns, parses, refreshes or exports tokens. Login success is not an inference or entitlement check; status success only reports the CLI command succeeded, not that a subscription model call is possible.
- Keep **all directory contents and ancestor directories trusted**. A 0700 home is not a sandbox against its owner; the wrapper does not inspect every existing config/file/symlink within it. Start with a fresh dedicated directory and do not import personal Codex configuration, symlink credential files, or mount it read-write into unrelated services. The administrator-selected binary and its updates are trusted code.
- Status/logout diagnostics are discarded. Wrapper failures are generic. A nonzero status can mean signed out, invalid credentials, CLI incompatibility or unavailable dependencies; it is not classified as a successful logout. Login diagnostics are visible only in the operator terminal and must not be collected as application logs.
- Login is bounded to 16 minutes; status/logout to 15 seconds, plus a one-second termination grace period. Timeout or SIGINT/SIGTERM terminates the owned process group, including descendants, before lock release. This does not control daemonized processes escaping that group; use only the official CLI, not an untrusted launcher.
- An exclusive `.opengranter-auth.lock` directory prevents concurrent wrapper operations. SIGKILL or host failure can leave a stale lock. Verify no matching official CLI/descendants remain using trusted host process tools before manually removing the empty lock directory. Never delete credentials or stop unrelated processes to recover a lock.
- Logout delegates local sign-out to Codex. Do not assume local logout globally revokes every previously issued token; use OpenAI account/workspace controls for incident response. Do not delete the home to represent logout success.

## Remaining inference gate

A separate Codex app-server/Responses integration is needed before OpenGranter can serve subscription-backed requests. It must preserve IAM/deny precedence, route constraints, limits, audit, token-usage/missing-cost semantics, streaming and tool boundaries; it must not execute arbitrary local agent tools or silently fall back to paid API usage. Account-to-principal mapping, deployment secret mounts, model entitlement, refresh/revocation, and real client E2E remain unresolved/unimplemented. No VM/container or gateway configuration is changed here.

## Sources checked 2026-11-01

- [Official Codex authentication](https://developers.openai.com/codex/auth)
- [Official app-server integration](https://developers.openai.com/codex/app-server)
- [Upstream device-code implementation](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs)
- [Sign in with ChatGPT app-server guidance](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server): a distinct application integration/registration path, not permission to reuse Codex credentials as arbitrary API keys.
