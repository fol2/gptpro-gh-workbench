# KS2 GitHub workbench establishment plan

Repository: `fol2/ks2-mastery`
Purpose: give the assistant a repeatable place to read the repo, refresh it safely, make local changes, create branches/PRs/issues, and review PRs when explicitly asked.

## 1. Non-negotiable access contract

A workbench is useful only if the assistant session can actually operate it. One of these must be true:

1. The assistant's shell has outbound HTTPS/DNS access to GitHub and can run `git`, `curl`, `jq`, and preferably `gh`.
2. A mounted working directory already contains a valid checkout at `/mnt/data/work/ks2-mastery`, and the session can run local commands in it.
3. A narrow GitHub bridge/connector is exposed to the assistant with functions for read, branch, commit, PR, issue, and review operations.

A remote VM, Codespace, or agent workspace that is not exposed through one of those routes is not useful to this assistant.

## 2. Recommended target shape

Create a directory and environment contract:

```bash
export KS2_REPO='fol2/ks2-mastery'
export KS2_REPO_DIR='/mnt/data/work/ks2-mastery'
export GIT_TERMINAL_PROMPT=0
export GH_NO_UPDATE_NOTIFIER=1
```

Install/expose these tools:

```bash
git
curl
jq
gh
node
npm
```

Optional but useful:

```bash
rg
python3
```

The repo README says the project uses a React browser shell, Cloudflare Worker backend, and Node test/check scripts, with `npm test` and `npm run check` as the core local verification commands.

## 3. Network requirements

The shell must be able to reach at least:

```text
github.com
api.github.com
raw.githubusercontent.com
codeload.github.com
objects.githubusercontent.com
```

Probe with:

```bash
curl -fsSI https://github.com | sed -n '1,5p'
curl -fsS https://api.github.com/meta | jq '{verifiable_password_authentication, hooks: (.hooks|length), git: (.git|length), web: (.web|length)}'
GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/fol2/ks2-mastery.git HEAD
```

If the environment is behind a proxy, set:

```bash
export HTTPS_PROXY='http://proxy.example:port'
export HTTP_PROXY='http://proxy.example:port'
export ALL_PROXY='http://proxy.example:port'
export NO_PROXY='localhost,127.0.0.1'
```

## 4. Authentication model

Use the narrowest credential that can do the requested work.

Best: GitHub App installation token.

Good: short-lived fine-grained PAT scoped only to `fol2/ks2-mastery`.

Avoid: broad classic PATs, account passwords, long-lived tokens stored in files, or tokens embedded in `origin` URLs.

Expose the token as an environment variable only:

```bash
export GH_TOKEN='...'
# or
export GITHUB_TOKEN='...'
```

Do not print it. Do not store it in the repo. Do not put it in command history. Revoke/rotate after the workbench is no longer needed.

### Permission tiers

Tier 0 — read-only clone and test:

```text
No token required for public repo, or Metadata read + Contents read if using auth.
```

Tier 1 — issue/PR triage and comments:

```text
Metadata: read
Contents: read
Issues: write
Pull requests: write
```

Tier 2 — branch push and PR creation:

```text
Metadata: read
Contents: write
Pull requests: write
Issues: write, optional
```

Tier 3 — workflow edits:

```text
Contents: write
Workflows: write
Pull requests: write
```

Tier 4 — merge/deploy/admin:

```text
Not enabled by default. Only grant for a single explicit user-approved action.
```

## 5. Bootstrap script the agent should install

Create `/mnt/data/work/bootstrap-ks2-github-workbench.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO='fol2/ks2-mastery'
REPO_URL="https://github.com/${REPO}.git"
ROOT='/mnt/data/work'
DIR="$ROOT/ks2-mastery"

export GIT_TERMINAL_PROMPT=0
export GH_NO_UPDATE_NOTIFIER=1

mkdir -p "$ROOT"

printf '== tools ==\n'
for t in git curl jq node npm; do
  command -v "$t" >/dev/null && "$t" --version 2>/dev/null | head -1 || { echo "missing: $t"; exit 2; }
done
if command -v gh >/dev/null; then gh --version | head -1; else echo 'missing: gh (REST fallback possible, but gh is preferred)'; fi

printf '\n== network ==\n'
curl -fsSI https://github.com | sed -n '1,5p'
curl -fsS https://api.github.com/meta >/dev/null
GIT_TERMINAL_PROMPT=0 git ls-remote "$REPO_URL" HEAD

printf '\n== auth ==\n'
if command -v gh >/dev/null; then
  gh auth status || true
fi
if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  curl -fsS \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    https://api.github.com/user | jq '{login,id}'
else
  echo 'No GH_TOKEN/GITHUB_TOKEN present; write operations disabled.'
fi

printf '\n== checkout ==\n'
if [ ! -d "$DIR/.git" ]; then
  git clone --filter=blob:none --single-branch --branch main "$REPO_URL" "$DIR"
fi
cd "$DIR"
git remote set-url origin "$REPO_URL"
git config pull.ff only
git config fetch.prune true
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git status --short --branch
git rev-parse HEAD

printf '\n== repo checks ==\n'
npm --version
npm test -- --runInBand 2>/dev/null || npm test || true
npm run check || true
```

The final `npm` commands are allowed to fail during bootstrap, because dependency installation may still be needed. The checkout/auth/network steps must not fail.

## 6. Preferred daily operating flow

Read-only refresh:

```bash
cd /mnt/data/work/ks2-mastery
git checkout main
git status --short
git pull --ff-only origin main
git rev-parse HEAD
```

Create a work branch:

```bash
cd /mnt/data/work/ks2-mastery
git checkout main
git pull --ff-only origin main
git checkout -b agent/YYYYMMDD-short-slug
```

After edits:

```bash
git diff --check
git status --short
npm test
npm run check
git add <files>
git commit -m "Short imperative summary"
git push -u origin agent/YYYYMMDD-short-slug
gh pr create -R fol2/ks2-mastery --base main --head agent/YYYYMMDD-short-slug --title "Title" --body-file /tmp/pr-body.md
```

If direct upstream push is not allowed, use a fork:

```bash
GH_USER=$(gh api user --jq .login)
gh repo fork fol2/ks2-mastery --clone=false --remote=false || true
git remote add fork "https://github.com/$GH_USER/ks2-mastery.git" 2>/dev/null || true
git push -u fork agent/YYYYMMDD-short-slug
gh pr create -R fol2/ks2-mastery --base main --head "$GH_USER:agent/YYYYMMDD-short-slug" --title "Title" --body-file /tmp/pr-body.md
```

Issue creation:

```bash
gh issue create -R fol2/ks2-mastery --title "Title" --body-file /tmp/issue-body.md
```

PR review:

```bash
gh pr view 123 -R fol2/ks2-mastery --json title,author,state,baseRefName,headRefName,mergeable,reviewDecision,statusCheckRollup
gh pr diff 123 -R fol2/ks2-mastery
# comment only unless the user explicitly asked for approve/request-changes
gh pr review 123 -R fol2/ks2-mastery --comment --body-file /tmp/review.md
```

## 7. Safety and authority rules

Default allowed:

- clone, fetch, inspect, search, run local tests;
- create local branches;
- prepare patches and PR bodies;
- create issues/PRs only when the user explicitly asks;
- post PR review comments only when the user explicitly asks.

Default disallowed:

- merge PRs;
- force-push shared branches;
- push directly to `main`;
- modify repository settings, secrets, branch protection, deployments, or billing;
- store or reveal tokens;
- create workflow changes unless the task explicitly includes CI/workflow work.

Merge policy:

- Treat merge as out of scope unless the user explicitly asks for one named PR to be merged.
- Before merge, report branch, PR number, checks, conflicts, and merge method.
- Never merge based only on being technically able to merge.

## 8. Acceptance criteria for the establishing agent

The workbench is ready only when all of these pass:

```bash
cd /mnt/data/work/ks2-mastery

# repo exists and is current
git status --short --branch
git rev-parse HEAD
git ls-remote origin HEAD

# fast-forward pull works
git checkout main
git pull --ff-only origin main

# GitHub API works
curl -fsS https://api.github.com/repos/fol2/ks2-mastery | jq '{full_name,default_branch}'

# auth works when token is intentionally provided
[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ] && gh repo view fol2/ks2-mastery --json nameWithOwner,defaultBranchRef,viewerPermission || true

# issue and PR read work when gh is available
gh issue list -R fol2/ks2-mastery --limit 3 || true
gh pr list -R fol2/ks2-mastery --limit 3 || true
```

For write readiness, perform a reversible/non-invasive test only after permission is granted. Preferred test:

1. Create branch `agent/workbench-smoke-YYYYMMDD` from `main`.
2. Create or update a harmless file under `.agent-smoke/` or a temporary branch-only file.
3. Push branch.
4. Open draft PR or normal PR titled `Workbench smoke test`.
5. Close PR and delete branch after verification.

Do not run this smoke test unless the user approves it.

## 9. Fallback if GitHub shell network remains blocked

If GitHub network cannot be opened, establish a bundle handoff instead:

```bash
# On a machine that can access GitHub
git clone https://github.com/fol2/ks2-mastery.git
cd ks2-mastery
git bundle create ks2-mastery-main.bundle main
```

Upload `ks2-mastery-main.bundle` to the assistant session. Then:

```bash
mkdir -p /mnt/data/work
cd /mnt/data/work
git clone /mnt/data/ks2-mastery-main.bundle ks2-mastery
cd ks2-mastery
git status --short --branch
```

This enables real local read-only Git work, but not live PR/issue operations. For live GitHub writes without shell network, the establishing agent must expose a GitHub connector/bridge.

## 10. Minimal connector/bridge API if shell networking is impossible

A narrow bridge should expose only these operations:

```text
repo.get(repo, ref)
repo.list_tree(repo, ref, path)
repo.get_file(repo, ref, path)
repo.search_code(repo, query)
repo.create_branch(repo, baseRef, branchName)
repo.commit_files(repo, branchName, message, changes[])
repo.open_pr(repo, base, head, title, body, draft)
repo.list_issues(repo, query)
repo.create_issue(repo, title, body, labels[])
repo.list_prs(repo, query)
repo.get_pr(repo, number)
repo.get_pr_diff(repo, number)
repo.review_pr(repo, number, event, body, comments[])
```

Bridge policy:

- scope only to `fol2/ks2-mastery`;
- no merge endpoint by default;
- no secrets/settings/admin endpoints;
- log all write calls;
- require idempotency keys for writes;
- return exact URLs/IDs for every created object.

## 11. What the assistant will do when it arrives

1. Run the bootstrap/preflight script.
2. Report whether the workspace is read-only, write-ready, or blocked.
3. If read-only works, use `git pull --ff-only` on `main` and inspect locally.
4. If write-ready works, use branches + PRs, not direct `main` pushes.
5. Keep merges disabled unless the user explicitly authorizes a specific merge.
