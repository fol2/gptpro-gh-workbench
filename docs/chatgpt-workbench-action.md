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
- Query string sessions remain available for manual browser/debug use only.
- The broker remains the final safety boundary for writes and merges.
- ZIP or git-bundle repository snapshots are read-only fallbacks for code inspection, not live GitHub authority.

## First Action: Readiness

Every ChatGPT session must call readiness before any read/write GitHub action is treated as usable:

```http
GET /api/action/readiness
X-Workbench-Session: <signed-session-token>
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

## Troubleshooting

| Classification or state | Meaning | Response |
|-------------------------|---------|----------|
| `missing_session` or `unauthorised_session` | The action did not present a valid workbench session. | Stop and fix action-side session configuration. |
| `github_token_missing` | The Worker has no GitHub token secret configured. | Stop; do not ask ChatGPT or James for a GitHub token in chat. |
| `github_upstream_failure` | The broker reached GitHub but GitHub failed the request. | Stop and inspect the upstream status/message. |
| `insufficient_repository_permission` | The GitHub viewer is authenticated but lacks write-capable repo permission. | Stop; do not attempt write actions. |
| write action unavailable | The ChatGPT action surface cannot perform the required write. | Keep read readiness only and use a human/operator bridge for writes. |
| not `broker_read_ready` | The read gate did not prove the broker is ready. | Stop before any write or merge. |

## Fallbacks

- Use `docs/ks2_workbench_broker_probe.py --session-auth header --json` from a runtime that has both session authority and broker network reachability.
- Use a ZIP or git-bundle snapshot for read-only code inspection when live clone is unavailable.
- Use structured patch/command handoff to an external operator only when the API action is not available.
