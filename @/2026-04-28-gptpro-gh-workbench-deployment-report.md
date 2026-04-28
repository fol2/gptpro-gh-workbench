# GPTPro GitHub Workbench Deployment Completion Report

Date: 2026-04-28
Repository: `fol2/gptpro-gh-workbench`
Target workbench subject: `fol2/ks2-mastery`
Public portal URL: `https://gptpro-gh-workbench.eugnel.uk/`
Signed session URL storage: `~/.config/gptpro-gh-workbench/session-url.txt`

## Executive Summary

The GPTPro GitHub Workbench project has been created as a separate public GitHub repository under `fol2`, implemented as a session-protected Cloudflare Worker portal, reviewed through independent SDLC gates, merged to remote `main`, deployed through a Cloudflare Workers route, and live-smoked at a public URL.

This report now includes the follow-up GitHub write-broker slice. Before the write-broker PR is merged and deployed, the public URL should still be treated as the previously live read-only portal. After merge and deployment, the intended live surface is deliberately conservative but no longer merely read-only: it lets ChatGPT or a human inspect a constrained status dashboard, call fixed GitHub read endpoints for `fol2/ks2-mastery`, and use a small set of session-protected GitHub write endpoints backed by a Worker secret `GH_TOKEN`. It does not accept GitHub tokens from callers, does not return tokens, does not run shell commands, does not expose arbitrary URL proxying, does not connect a private executor, and does not provide merge, workflow, admin, secret, or direct-main-write operations.

The first live fallback used a temporary Cloudflare Tunnel while the local Wrangler OAuth session was inactive. After the Cloudflare OAuth approval was completed, the Worker was deployed officially and bound to `gptpro-gh-workbench.eugnel.uk/*` as a Cloudflare Workers route. The tunnel fallback was stopped and the named tunnel was deleted before the final smoke, so the current URL is served by Cloudflare Workers rather than by a local tunnel.

## What Is Working Now

- The repository exists publicly at `https://github.com/fol2/gptpro-gh-workbench`.
- Remote `main` contains the portal foundation and secure-cookie hotfix.
- The portal is reachable at `https://gptpro-gh-workbench.eugnel.uk/` through a Cloudflare Workers route.
- The portal requires a valid workbench session token before dashboard or API data is returned.
- The signed dashboard sets a `gptpro_workbench_session` cookie with `HttpOnly`, `SameSite=Strict`, and `Secure`.
- Dashboard JSON endpoint links preserve the signed-session query so a URL-first client can inspect them without immediately dropping auth.
- `GET /api/status` reports portal capability and exposes deployment status from `WORKBENCH_DEPLOYMENT_STATUS`.
- `GET /api/github/auth` reports token-backed GitHub identity and repository permission without exposing the token.
- `GET /api/github/repo` reads metadata for `fol2/ks2-mastery` and returns `default_branch: main`.
- Unauthenticated requests to the status API return `401`.
- Official Worker secrets are set for `WORKBENCH_SESSION_TOKEN`, `WORKBENCH_DEPLOYMENT_STATUS`, and `GH_TOKEN`.
- GitHub write access is connected through allowlisted REST API operations only: issue creation, issue/PR comment creation, `agent/...` branch creation from `main`, single-file create/update on `agent/...` branches, and PR creation from `agent/...` branches.
- The private executor remains absent; local checkout inspection, `git`, `npm test`, repo-native scripts, and arbitrary shell commands are still not exposed through the public Worker.

The signed session URL is intentionally not committed to the repository. It is stored locally with `0600` permissions at:

```text
~/.config/gptpro-gh-workbench/session-url.txt
```

## Delivery Timeline

1. Created public repository `fol2/gptpro-gh-workbench` from the local project.
2. Merged the planning completion report to `main` through PR #1.
3. Implemented the Cloudflare Worker portal foundation on an isolated worktree branch.
4. Opened PR #2, ran tests and checks, and sent it through independent security and design review.
5. Addressed review findings:
   - Added session-gated access for all dashboard/API data routes.
   - Disabled `workers_dev`.
   - Preserved signed-session links for JSON endpoint inspection.
   - Made deployment status environment-driven.
   - Mapped GitHub upstream failures to non-200 responses.
6. Re-ran independent final reviewers; both returned no blockers.
7. Merged PR #2 to `main`.
8. Detected a tunnel-specific cookie hardening gap during live smoke: the local HTTP origin path could omit `Secure` before Cloudflare.
9. Opened PR #3 to always set `Secure` on the session cookie.
10. Ran an independent hotfix review; no blockers.
11. Merged PR #3 to `main`.
12. Fast-forwarded local `main` and smoke-tested a tunnel fallback while Wrangler auth was still blocked.
13. Completed `wrangler login` through Cloudflare OAuth.
14. Deployed the Worker through Wrangler using a Worker route on `gptpro-gh-workbench.eugnel.uk/*`.
15. Uploaded Worker secrets for `WORKBENCH_SESSION_TOKEN` and `WORKBENCH_DEPLOYMENT_STATUS`.
16. Stopped the local Worker runtime and tunnel fallback, then live-smoked the public URL again to prove the Cloudflare Worker route was serving traffic.
17. Created a scoped GitHub token for `fol2`, stored it locally with `0600` permissions, verified `gh auth status`, and uploaded it to the Worker as `GH_TOKEN`.
18. Implemented the write-broker slice on a separate worktree branch with fixed `fol2/ks2-mastery` REST API writes and no shell path.
19. Sent the slice through independent security and functional reviewers. Review follow-up fixed file-content trimming, non-object JSON handling, anonymous read endpoint regression risk, and documentation timing.

## Merged Pull Requests

- PR #1: planning report merged to `main`.
- PR #2: Cloudflare portal foundation merged to `main`.
  - Merge commit: `f7c6dbb026299e0d09da5dddcc7ca1b9b3314561`
- PR #3: secure session cookie hotfix merged to `main`.
  - Merge commit: `fed2b4126527d53b44fdb4d13ebbf5a492c5ba50`
- PR #4: deployment report and Worker route configuration merged to `main`.
- PR #5: GitHub write-broker slice, pending merge/deploy at the time this report section was drafted.

## Runtime Architecture

The current runtime is:

```text
ChatGPT / browser
  -> https://gptpro-gh-workbench.eugnel.uk/
  -> Cloudflare DNS
  -> Cloudflare Workers route: gptpro-gh-workbench.eugnel.uk/*
  -> Worker script: gptpro-gh-workbench
  -> fixed GitHub REST API reads and allowlisted writes for fol2/ks2-mastery
```

This is now a Cloudflare Workers route deployment. It no longer depends on the local Mac, `tmux`, a local Wrangler dev process, or a running `cloudflared` tunnel for the public URL.

Local operational files kept for recovery and session URL reference:

```text
~/.config/gptpro-gh-workbench/session-token
~/.config/gptpro-gh-workbench/session-url.txt
```

The Worker-side session secret is stored in Cloudflare as `WORKBENCH_SESSION_TOKEN`. The GitHub credential is stored in Cloudflare as `GH_TOKEN`. Local token files are only recovery references for operation and should not be committed.

The earlier tunnel fallback used a short-lived local env file:

```text
~/.config/gptpro-gh-workbench/workbench.env
```

It is no longer required for the public URL, but remains useful if a local fallback must be restarted.

## Live Smoke Evidence

Latest live-smoke result after the original official Worker route deployment and after stopping the local tunnel/runtime fallback:

```text
unauthenticated /api/status: 401
authenticated /api/status: 200
authenticated /: 200
authenticated /api/github/repo: 200
```

Live `/api/status` returned:

```json
{
  "portal_status": "responding/read-only foundation",
  "deployment_status": "worker route live-smoked on 2026-04-28T16:20:03Z",
  "access_status": "session required",
  "target_repo": "fol2/ks2-mastery"
}
```

Live `/api/github/repo` returned the expected target repository identity:

```json
{
  "full_name": "fol2/ks2-mastery",
  "default_branch": "main",
  "private": false
}
```

The signed dashboard response was also checked for:

```text
read-only dashboard copy: present
executor disconnected copy: present
deployment status copy: present
signed /api/status link: present
Set-Cookie Secure: present
Set-Cookie HttpOnly: present
Set-Cookie SameSite=Strict: present
```

Write-broker live-smoke evidence must be refreshed after the write-broker PR is merged and deployed. The expected post-deploy checks are:

```text
unauthenticated /api/status: 401
authenticated /api/status: 200
authenticated /api/github/auth: 200
authenticated /api/github/repo: 200
authenticated dashboard contains narrow broker copy
authenticated responses do not contain GH_TOKEN or token prefixes
```

## Verification Commands

Across the implementation and hotfix PRs, the following checks passed:

```sh
npm test
npm run check
git diff --check origin/main...HEAD
npm audit --omit=dev
npm audit --audit-level=high
```

Final verification after the GitHub write-broker slice:

```text
npm test: 20/20 passed
npm run check: passed
git diff --check: passed
```

Independent reviewers also ran targeted curl and Wrangler dry-run checks. The final security review for PR #2 found no blockers, and the PR #3 hotfix review found no blockers.

## Security Boundaries

Confirmed boundaries in the current implementation:

- No direct pushes to `main` were used for product changes.
- No GitHub token is accepted from callers by the portal.
- No GitHub token is echoed by the portal.
- Repository write operations are allowlisted and fixed to `fol2/ks2-mastery`.
- Direct writes to `main` are rejected.
- Branch writes are limited to `agent/...` branches.
- Workflow file edits under `.github/workflows/` are rejected.
- Path traversal, absolute paths, non-JSON bodies, and oversized request bodies are rejected.
- Merge, deployment, repository admin, secret, billing, and workflow-management endpoints are not exposed.
- No shell, subprocess, or executor command path exists.
- No arbitrary URL fetch path exists.
- GitHub API reads are fixed to `https://api.github.com/repos/fol2/ks2-mastery`.
- Session gating happens before dashboard/API data routes.
- CORS is enabled without credentials.
- GitHub upstream failures are not returned as false HTTP 200 success responses.
- `workers_dev` is disabled in the Worker config.

The main residual exposure is capability-related rather than deployment-related: once this slice is deployed, the Worker can perform constrained GitHub API writes, but it still cannot run local verification, inspect a full checkout, or execute repo-native scripts. Full SDLC automation still needs a private executor behind the portal.

## GitHub Write Access

Cloudflare deployment is complete for the original portal, and GitHub authentication has been connected through a Worker secret for the write-broker slice.

Cloudflare authentication and GitHub authentication are separate:

- Cloudflare auth deploys and configures the Worker.
- GitHub auth is required before a broker or executor can create branches, open PRs, or comment on PRs/issues.

The current short-term credential is a fine-grained PAT exposed only as `GH_TOKEN` in the Worker environment and local operator store. It is not embedded in the Git remote URL, committed to the repository, accepted from callers, or returned by the public Worker. A GitHub App installation token remains the preferred long-term credential model because it can be rotated and scoped more cleanly.

The earlier Cloudflare auth errors were resolved by completing `wrangler login`:

```text
Invalid access token [code: 9109]
Authentication error [code: 10000]
refresh_token: token_inactive
```

The final deploy path used:

```sh
npx wrangler deploy --route 'gptpro-gh-workbench.eugnel.uk/*'
npx wrangler secret put WORKBENCH_SESSION_TOKEN
npx wrangler secret put WORKBENCH_DEPLOYMENT_STATUS
npx wrangler secret put GH_TOKEN
```

## Recommended Next Step

The next engineering slice should connect a private executor behind the existing narrow action broker. It should preserve the current public contract:

- URL-first dashboard and JSON status remain browser-readable after session auth.
- No generic shell or arbitrary proxy is introduced.
- GitHub actions are allowlisted.
- GitHub write credentials stay outside browser-visible surfaces.
- Every state-changing action has explicit audit output and an approval boundary.

The private executor should be responsible for clone/fetch, local diffs, `npm test`, `npm run check`, and repo-native scripts. The Worker should remain the session-protected URL front door and should not grow into a generic shell.

## Bottom Line

The project is real, public, merged, deployed, and reachable through a working Cloudflare Workers URL. The write-broker slice turns that URL into a safe session-protected GitHub workbench broker after merge and deploy: it can prove GitHub auth and perform constrained issue, comment, branch, file, and PR operations against `fol2/ks2-mastery` without exposing a token or shell. The remaining gap is private executor capability for local checkout work and verification.
