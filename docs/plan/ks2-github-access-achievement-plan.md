# KS2 GitHub Access: Practical Path to a Working Assistant Workflow

Date: 2026-04-28

## Current environment facts

The assistant runtime has three separate planes:

1. Local execution plane: can run bash/Python and read/write files under `/mnt/data`.
2. Web/browsing plane: can read public web/GitHub pages and raw text in some cases.
3. Shell network plane: currently cannot reliably resolve GitHub or the workbench broker host.

A signed session URL exported on the user's Mac, Codex runtime, or another agent's container does not appear in this assistant runtime. The assistant can use a session URL only if it is present in this runtime as one of:

- `KS2_WORKBENCH_SESSION_URL`
- `--session-url ...`
- `~/.config/gptpro-gh-workbench/session-url.txt`
- another readable file explicitly handled by the probe

The current good probe contract is:

```bash
python3 -S /mnt/data/ks2_workbench_broker_probe.py --json
```

Continue only when the JSON classification is `broker_read_ready`.

Merge must require explicit user approval and must include the expected PR head SHA:

```bash
python3 -S /mnt/data/ks2_workbench_broker_probe.py \
  --merge-pr <PR_NUMBER> \
  --expected-head-sha <HEAD_SHA> \
  --json
```

## Why the current approach stalls

The REST broker is a good security design, but the current client path is wrong for this ChatGPT runtime.

A shell command can only call the broker if both are true:

1. the signed session URL is present in the same runtime, and
2. the shell can resolve/reach `gptpro-gh-workbench.eugnel.uk`.

Right now this runtime repeatedly fails both checks. The assistant cannot invent the session URL, and cannot make external DNS work from inside the container.

Therefore, relying on `export KS2_WORKBENCH_SESSION_URL=...` from another machine will not achieve the goal.

## Recommended target architecture

Use a ChatGPT-visible API connector/action as the primary path, not shell curl/Python.

The connector should call the existing broker and hold the signed workbench session as connector-side auth. The assistant should never see a GitHub token. Ideally, the assistant should not see the signed session either; it should only see broker responses.

### Required connector operations

Read:

- `GET /api/status`
- `GET /api/actions`
- `GET /api/github/repo`
- `GET /api/github/auth`
- `GET /api/github/prs?limit=...`
- `GET /api/github/issues?limit=...`

Write:

- `POST /api/github/issues`
- `POST /api/github/comments`
- `POST /api/github/branches`
- `POST /api/github/files`
- `POST /api/github/pulls`
- `POST /api/github/pulls/close`
- `POST /api/github/branches/delete`
- `POST /api/github/pulls/merge`

### Recommended broker auth adjustment

Keep supporting `?session=...` for manual debugging, but add header auth for connector use:

```text
X-Workbench-Session: <signed-session-token>
```

This avoids putting secrets in URLs, logs, citations, browser history, or assistant-visible text.

### Connector readiness response

The connector should expose one simple readiness call, equivalent to the probe:

```json
{
  "ok": true,
  "classification": "broker_read_ready",
  "target_repo": "fol2/ks2-mastery",
  "viewer": "fol2",
  "permission": "ADMIN",
  "actions": ["..."]
}
```

If this is not returned, the assistant must stop.

## Fallback paths

### Read-only repo work

If the shell cannot clone GitHub, use a `git bundle` or uploaded ZIP snapshot placed in `/mnt/data`. This enables local search, code review, and patch generation, but not live PR/issue actions.

### Browser/raw read only

Use web/raw GitHub access for targeted file reading when clone/bundle is unavailable. This is useful for planning but not enough for robust edits or tests.

### Human/agent execution bridge

If no connector can be exposed to ChatGPT, the assistant can prepare structured JSON commands or patch files, but an external agent must execute them. That is not autonomous GitHub interaction from this assistant.

## Operating rules once connector works

1. Run read gate first.
2. Continue only if `classification == broker_read_ready`.
3. Create only `agent/...` branches.
4. Never write directly to `main`.
5. Never ask for or use a GitHub token.
6. Open PRs from `agent/...` branches only.
7. Close/delete only temporary `agent/...` branches created by the assistant.
8. Merge only after explicit user approval for a specific PR.
9. Merge only open, non-draft `agent/...` PRs into `main`.
10. Merge only with `expectedHeadSha` supplied.
11. Broker should use squash merge only.

## Definition of done

The goal is achieved when one of these is true:

### Best: connector path

The assistant has a visible API connector/tool that can call the broker's read and write endpoints and returns `broker_read_ready` before writes.

### Acceptable: same-runtime shell path

The same assistant runtime contains a signed session URL file and can resolve/reach the broker host from Python. Then the probe script can be used directly.

### Read-only only

A git bundle or ZIP snapshot is uploaded to `/mnt/data`; the assistant can inspect code and produce patches, but cannot create/update PRs or issues itself.

## Bottom line

The practical fix is not another `export` instruction. It is to move the broker client into a tool plane this assistant can actually invoke. The safest version is a ChatGPT-visible API connector with broker-side GitHub credentials and connector-side workbench session auth.
