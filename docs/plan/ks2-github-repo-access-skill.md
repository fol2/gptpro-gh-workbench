# KS2 GitHub repo access skill

Repository: `fol2/ks2-mastery`
Primary goal: get a local read-only checkout that can be refreshed safely.
Secondary goal: understand when PR / issue / review operations are possible.

## 0. Always start with a probe

Run this first in a fresh session:

```bash
set -u
REPO_URL="https://github.com/fol2/ks2-mastery.git"
WORKDIR="/mnt/data/work/ks2-mastery"

echo "== tools =="
git --version || true
command -v git || true
command -v gh || true
command -v ssh || true
command -v curl || true

echo "== network =="
GIT_TERMINAL_PROMPT=0 git ls-remote "$REPO_URL" HEAD || true
curl -I --max-time 10 https://github.com 2>&1 | sed -n '1,12p' || true

echo "== proxy env =="
env | sort | grep -iE '^(https?_proxy|all_proxy|no_proxy|GITHUB_|GH_)=' || true
```

Interpretation:

- If `git ls-remote` prints a commit SHA, direct read-only Git works. Use Mode A.
- If it says `Could not resolve host: github.com` or direct IP connections fail, direct shell network is unavailable. Use Mode B for limited read-only inspection, or ask for a repo archive / git bundle if a real local checkout is required.
- If `gh` is missing, PR / issue / review work through GitHub CLI is unavailable unless you install it or use the REST API through a working network path.
- If `ssh` is missing, SSH clone cannot work in this container. Prefer HTTPS.

## Mode A — true read-only clone and refresh

Use HTTPS first. Public read-only clone does not need a token.

```bash
mkdir -p /mnt/data/work
cd /mnt/data/work
GIT_TERMINAL_PROMPT=0 git clone --filter=blob:none --single-branch --branch main \
  https://github.com/fol2/ks2-mastery.git ks2-mastery
cd ks2-mastery

git remote -v
git status --short --branch
git rev-parse HEAD
```

For a normal refresh of a clean `main` checkout:

```bash
cd /mnt/data/work/ks2-mastery
git checkout main
git status --short
GIT_TERMINAL_PROMPT=0 git pull --ff-only origin main
```

For a feature branch with local commits:

```bash
cd /mnt/data/work/ks2-mastery
git fetch origin
git checkout my-feature-branch
git rebase origin/main
# If the rebase is wrong or too messy:
# git rebase --abort
```

Recommended repo-local safety settings:

```bash
git config pull.ff only
git config fetch.prune true
```

Do not work directly on `main` unless the task is strictly read-only. Keep `main` clean so `git pull --ff-only` stays boring.

## Mode B — limited read-only fallback when shell GitHub network is blocked

Observed in this session: direct `git ls-remote` and `curl https://github.com` failed in the shell, but `web.run` could open GitHub pages and raw files. After a raw file URL is opened through `web.run`, `container.download` can sometimes save that exact raw URL.

This fallback is useful for targeted inspection of known files. It is not a true clone and cannot run the whole test suite unless the needed files are mirrored manually.

Workflow:

1. Open the GitHub repo through the browser tool:
   `https://github.com/fol2/ks2-mastery`
2. Open the raw file URL through the browser tool, for example:
   `https://raw.githubusercontent.com/fol2/ks2-mastery/main/README.md`
3. Download that exact raw URL into `/mnt/data` using the download bridge.
4. Use the file locally for inspection.

Important limitations seen in this session:

- GitHub archive ZIP URLs redirected to `codeload.github.com` and could not be opened safely by the browser tool, so they could not be downloaded.
- Some raw file types may be rejected by the download bridge based on detected content type.
- This mode cannot support `git pull`, diffs against full history, branch checkout, or local CI unless enough files are manually mirrored.

If a real local checkout is required while direct GitHub shell network is blocked, the best practical workaround is to ask the user to upload one of these:

```bash
# On a machine with GitHub access:
git clone https://github.com/fol2/ks2-mastery.git
cd ks2-mastery
git bundle create ks2-mastery-main.bundle main
# Upload ks2-mastery-main.bundle to the session.
```

Then in the session:

```bash
mkdir -p /mnt/data/work
cd /mnt/data/work
git clone /mnt/data/ks2-mastery-main.bundle ks2-mastery
cd ks2-mastery
git status --short --branch
```

A `.zip` or `.tar.gz` archive is also acceptable for read-only file work, but a `git bundle` preserves commit history and makes normal Git commands work locally.

## Mode C — GitHub interaction: issues, PRs, reviews

This requires three things:

1. A working network path to GitHub from the tool that will perform the write.
2. Authentication: `GH_TOKEN`, `GITHUB_TOKEN`, GitHub App token, or an authenticated `gh` session.
3. Repository permissions appropriate to the action.

Current-session result: this was not available. `gh` was not installed, `ssh` was not installed, and shell network to `github.com` failed. Therefore I could not create / update / review a live PR or issue from this environment.

### If `gh` is available

Check auth:

```bash
gh auth status
```

Create issue:

```bash
gh issue create -R fol2/ks2-mastery \
  --title "Short issue title" \
  --body-file issue-body.md
```

Create PR from a pushed branch:

```bash
git checkout -b agent/my-change
git add path/to/file
git commit -m "Describe change"
git push -u origin agent/my-change

gh pr create -R fol2/ks2-mastery \
  --base main \
  --head agent/my-change \
  --title "Describe change" \
  --body-file pr-body.md
```

Review a PR:

```bash
gh pr diff 123 -R fol2/ks2-mastery
gh pr review 123 -R fol2/ks2-mastery --comment --body-file review.md
# Or, with authority and confidence:
# gh pr review 123 -R fol2/ks2-mastery --approve --body "Looks good."
# gh pr review 123 -R fol2/ks2-mastery --request-changes --body-file review.md
```

Do not merge unless the user explicitly asks, the branch protection allows it, tests/checks are understood, and the token has permission.

### If only REST API is available

Use a token from an environment variable. Never print it.

```bash
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN first}"
API="https://api.github.com"
OWNER="fol2"
REPO="ks2-mastery"

curl -fsS \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$API/repos/$OWNER/$REPO"
```

REST actions are possible in principle:

- create / edit issues with the Issues API and Issues write permission;
- create / edit PRs with the Pull Requests API and write access to the head/source branch;
- create PR reviews with Pull requests write permission;
- create commits or update files with Contents write permission, preferably on a branch, then open a PR.

For multi-file code changes, prefer normal Git push to a branch. Use Contents API only for small, controlled file changes.

## Session-specific conclusion from 2026-04-28

- The repo is public and browsable.
- Direct shell clone did not work because `github.com` could not be resolved from the container.
- Direct shell HTTPS and direct IP egress both failed.
- SSH clone did not work because the `ssh` binary is missing.
- `gh` is not installed.
- Browser/web access to GitHub works for rendered pages and raw text files.
- A true local read-only clone is available only in sessions where shell GitHub network works, or when the user uploads a git bundle/archive.
- GitHub write interactions are possible in principle but not in this session without a working write-capable network path, a token, and the needed repo permissions.
