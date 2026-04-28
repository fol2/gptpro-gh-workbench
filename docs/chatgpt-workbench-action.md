# ChatGPT Workbench API Action

Date: 2026-04-28

This document defines the ChatGPT Pro API connector/action path for the GPTPro GitHub Workbench broker.

The action surface is deliberately thin:

```text
ChatGPT Pro web
  -> configured API connector/action
  -> GPTPro Workbench broker
  -> GitHub REST API through the broker-held GH_TOKEN
```

ChatGPT does not install packages, run shell commands, clone repositories, export environment variables, or receive a GitHub token. The action calls hosted HTTP endpoints that already enforce the broker's repository, branch, path, cleanup, and merge limits.

## Authority Boundaries

- `GH_TOKEN` stays in the Cloudflare Worker environment and is never sent to ChatGPT.
- The workbench session is held by action-side configuration or broker-side secret mapping.
- Action-to-broker calls should use `X-Workbench-Session: <signed-session-token>`.
- If the action setup cannot send a hidden header, James can create a short-lived one-time passcode from an authenticated workbench session and ChatGPT can exchange it for an `actionSession` carried in JSON bodies.
- Query string sessions remain available for manual browser/debug use only.
- The broker remains the final safety boundary for writes and merges.
- ZIP or git-bundle repository snapshots are read-only fallbacks for code inspection, not live GitHub authority.

## Bootstrap Options

Preferred connector setup:

```http
GET /api/action/readiness
X-Workbench-Session: <signed-session-token>
```

Fallback setup when ChatGPT cannot store or inject a hidden header:

1. James opens the authenticated portal or uses a trusted operator client to create one short-lived passcode.

The simple local command is:

```sh
npm run passcode -- fol2/ks2-mastery
```

Use `npm run passcode -- fol2/gptpro-gh-workbench --read-only` for read-only workbench-repository testing, or `npm run passcode -- fol2/ks2-mastery --merge` only when James explicitly wants a merge-capable session.

```http
POST /api/action/passcodes
X-Workbench-Session: <signed-session-token>
Content-Type: application/json

{
  "repo": "fol2/ks2-mastery",
  "write": true,
  "merge": false,
  "maxRequests": 500,
  "sessionTtlSeconds": 18000
}
```

2. ChatGPT exchanges that one-time passcode once. Use a placeholder in docs and prompts; do not paste a real passcode into saved documentation.

```http
POST /api/action/exchange
Content-Type: application/json

{
  "passcode": "<one-time-passcode>"
}
```

3. The broker returns an `actionSession`. ChatGPT includes that value in later JSON bodies. The passcode cannot be reused.

```json
{
  "actionSession": "<action-session>",
  "classification": "continue only after readiness returns broker_read_ready"
}
```

The `actionSession` is still constrained: it is short-lived, request-limited, repository-bound, and scope-bound. The default exchanged session lasts 300 minutes and allows up to 500 requests. It does not reveal `GH_TOKEN` or the workbench session.

## First Action: Readiness

Every ChatGPT session must call readiness before any read/write GitHub action is treated as usable:

```http
GET /api/action/readiness
X-Workbench-Session: <signed-session-token>
```

For the passcode fallback, call readiness with the body-carried `actionSession`:

```http
POST /api/action/readiness
Content-Type: application/json

{
  "actionSession": "<action-session>"
}
```

The action may include an allowlisted repository selector:

```http
GET /api/action/readiness?repo=fol2%2Fgptpro-gh-workbench
X-Workbench-Session: <signed-session-token>
```

Continue only when the response contains:

```json
{
  "ok": true,
  "classification": "broker_read_ready",
  "target_repo": "fol2/ks2-mastery",
  "viewer": "fol2",
  "permission": "ADMIN"
}
```

If readiness returns any other classification, ChatGPT must stop rather than retrying with broader authority.

## Fixed Action Operations

The connector/action should expose these fixed operations. It should not expose a generic GitHub proxy, arbitrary URL fetch, shell command, local clone, settings, secrets, billing, deployment, or workflow-management operation.

| Action | Broker endpoint | Notes |
|--------|-----------------|-------|
| Readiness | `GET /api/action/readiness` | First call; must return `broker_read_ready` before writes. |
| Create passcode | `POST /api/action/passcodes` | Normal workbench session required; returns a short-lived one-time passcode. |
| Exchange passcode | `POST /api/action/exchange` | Exchanges a one-time passcode for an `actionSession`; no workbench session header needed. |
| Body readiness | `POST /api/action/readiness` | Same read gate using JSON body `actionSession`. |
| Body status | `POST /api/action/status` | Broker capability summary using JSON body `actionSession`. |
| Body actions | `POST /api/action/actions` | Operation list using JSON body `actionSession`. |
| Body repository | `POST /api/action/github/repo` | Allowlisted repository metadata using JSON body `actionSession`. |
| Body auth | `POST /api/action/github/auth` | Viewer and repository permission using JSON body `actionSession`. |
| Body pull requests | `POST /api/action/github/prs` | Open pull requests using JSON body `actionSession` and optional `limit`. |
| Body issues | `POST /api/action/github/issues` | Open issues using JSON body `actionSession` and optional `limit`. |
| Status | `GET /api/status` | Broker capability and boundary summary. |
| Actions | `GET /api/actions` | Fixed operation list and disabled executor/admin capabilities. |
| Repository | `GET /api/github/repo` | Allowlisted repository metadata. |
| Auth | `GET /api/github/auth` | Token-backed viewer and repository permission without token return. |
| Pull requests | `GET /api/github/prs?limit=N` | Open pull requests with conservative limit cap. |
| Issues | `GET /api/github/issues?limit=N` | Open issues, excluding pull requests where practical. |
| Create issue | `POST /api/github/issues` | Allowlisted repository only. |
| Create comment | `POST /api/github/comments` | Issue or pull request number only. |
| Create branch | `POST /api/github/branches` | `agent/...` branch from `main` only. |
| Write file | `POST /api/github/files` | One repository-relative file on an `agent/...` branch. |
| Create pull request | `POST /api/github/pulls` | From `agent/...` branch into `main`. |
| Close pull request | `POST /api/github/pulls/close` | Cleanup by pull request number. |
| Delete branch | `POST /api/github/branches/delete` | Cleanup for validated `agent/...` branches. |
| Guarded merge | `POST /api/github/pulls/merge` | Squash merge only, explicit approval, `expectedHeadSha` required by operating rule. |

## Write Rules

The action can ask ChatGPT or James for confirmation, but confirmation is not the safety boundary. The broker must still reject unsafe requests.

- Create only `agent/...` branches.
- Never write files directly to `main`.
- Never edit `.github/workflows/...`.
- Never accept arbitrary Git refs or repository paths.
- Never accept or return `GH_TOKEN`, bearer tokens, cookies, or raw session material.
- Close/delete only temporary PRs and validated `agent/...` branches.
- Merge only open, non-draft `agent/...` pull requests from an allowlisted repository into that repository's `main`.
- Merge with squash only.
- Merge only after explicit user approval for the exact PR and current head SHA.

## Registration Notes

Action registration metadata, if required by the ChatGPT connector/action UI, should mirror the fixed operation list above. It must not become the source of truth for security. The broker code and tests remain authoritative.

The action setup should store the workbench session outside the prompt-visible argument set. If the action setup cannot store a hidden session directly, add a minimal broker-side action secret mapping rather than asking ChatGPT to pass the signed session URL in normal messages.

For the passcode fallback, configure ChatGPT actions as normal JSON POST operations. No package installation, local shell, browser extension, or environment variable is expected inside the ChatGPT runtime.

Recommended ChatGPT test script:

```text
1. Call POST /api/action/exchange with {"passcode":"<one-time-passcode>"}.
2. Save the returned actionSession only for this chat session.
3. Call POST /api/action/readiness with {"actionSession":"<action-session>"}.
4. Continue only if classification is broker_read_ready.
5. Use fixed broker endpoints only. Include actionSession in every JSON body.
6. Do not request GH_TOKEN, WORKBENCH_SESSION_TOKEN, shell access, arbitrary URLs, or direct main writes.
7. For merge, stop unless James explicitly names the exact PR and current expectedHeadSha.
```

## Troubleshooting

| Classification or state | Meaning | Response |
|-------------------------|---------|----------|
| `missing_session` or `unauthorised_session` | The action did not present a valid workbench session. | Stop and fix action-side session configuration. |
| `action_store_missing` | The Worker has no `WORKBENCH_ACTION_KV` binding. | Stop and deploy/configure the action-session KV store. |
| `invalid_action_passcode` | The passcode is invalid, expired, or already used. | Ask James for a fresh one-time passcode; do not retry the same value. |
| `action_session_required` | The JSON body did not include `actionSession`. | Stop and exchange a one-time passcode first. |
| `invalid_action_session` | The `actionSession` is expired, malformed, or not recognised. | Stop and exchange a fresh one-time passcode. |
| `action_session_scope_denied` | The action session does not grant the requested read/write/merge scope. | Stop; do not ask for broader authority unless James explicitly wants that operation. |
| `github_token_missing` | The Worker has no GitHub token secret configured. | Stop; do not ask ChatGPT or James for a GitHub token in chat. |
| `github_upstream_failure` | The broker reached GitHub but GitHub failed the request. | Stop and inspect the upstream status/message. |
| `insufficient_repository_permission` | The GitHub viewer is authenticated but lacks write-capable repo permission. | Stop; do not attempt write actions. |
| write action unavailable | The ChatGPT action surface cannot perform the required write. | Keep read readiness only and use a human/operator bridge for writes. |
| not `broker_read_ready` | The read gate did not prove the broker is ready. | Stop before any write or merge. |

## Fallbacks

- Use `docs/ks2_workbench_broker_probe.py --session-auth header --json` from a runtime that has both session authority and broker network reachability.
- Use a ZIP or git-bundle snapshot for read-only code inspection when live clone is unavailable.
- Use structured patch/command handoff to an external operator only when the API action is not available.
