# Operator Codex OAuth contract (#635)

Public boundary: `npm run codex:auth -- login|status|logout` with administrator-provided absolute `OPENGRANTER_CODEX_BIN` and `OPENGRANTER_CODEX_HOME`.

| Case | Expected outcome |
| --- | --- |
| Login in a new canonical dedicated home under an existing parent | Create owned 0700 home, run official CLI device authorization without a shell, force ChatGPT/file storage; operator terminal handles authorization |
| Existing insecure, foreign-owned, personal default (process home or supplied env.HOME), or symlink home | Fail before launching CLI; do not repair permissions |
| Unknown action, extra arguments, non-absolute paths, missing executable | Fail without launching another command |
| Status/logout | Require existing private home, invoke only login status/logout, discard child output and sanitize errors |
| Successful status | Report CLI status success only, never assert subscription entitlement, token validity or inference readiness |
| Provider credentials/config inherited by parent | Not present in child; HOME/CODEX_HOME/XDG locations isolated |
| Concurrent wrapper operation | Fail closed; never remove another operation's lock |
| Nonzero/spawn failure | Generic wrapper error, no OS paths, tokens or captured provider diagnostics |
| Cancellation observed before storage creation, including during asynchronous validation | Reject without creating the credential home or launching the CLI |
| Timeout or cancellation | Terminate owned process group with bounded grace period before releasing own lock; never affect unrelated processes |
| Wrapper success | No model call, API-key fallback, provider registration, model discovery, gateway endpoint or host deployment |

Trusted inputs: installed CLI binary, parent directories and existing contents of the dedicated home. This is an operator tool, not a filesystem sandbox or remote/public authentication API. Automated fixtures contain no real credentials and perform no network requests. See [operator guide](../docs/guides/codex-oauth.md) and [plan](../docs/plans/635-codex-device-oauth.md).
