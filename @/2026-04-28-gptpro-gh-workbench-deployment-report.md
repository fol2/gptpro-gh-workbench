# GPTPro GitHub Workbench Deployment Completion Report

Date: 2026-04-28
Repository: `fol2/gptpro-gh-workbench`
Target workbench subject: `fol2/ks2-mastery`
Public portal URL: `https://gptpro-gh-workbench.eugnel.uk/`
Signed session URL storage: `~/.config/gptpro-gh-workbench/session-url.txt`

## Executive Summary

The GPTPro GitHub Workbench project has been created as a separate public GitHub repository under `fol2`, implemented as a session-protected read-only Cloudflare Worker portal, reviewed through independent SDLC gates, merged to remote `main`, deployed through a Cloudflare Workers route, and live-smoked at a public URL.

The current live surface is deliberately conservative. It lets ChatGPT or a human inspect a constrained status dashboard and fixed GitHub read endpoints for `fol2/ks2-mastery`. It does not accept GitHub tokens, does not run shell commands, does not expose arbitrary URL proxying, does not connect a private executor, and does not perform GitHub write actions.

The first live fallback used a temporary Cloudflare Tunnel while the local Wrangler OAuth session was inactive. After the Cloudflare OAuth approval was completed, the Worker was deployed officially and bound to `gptpro-gh-workbench.eugnel.uk/*` as a Cloudflare Workers route. The tunnel fallback was stopped and the named tunnel was deleted before the final smoke, so the current URL is served by Cloudflare Workers rather than by a local tunnel.

## What Is Working Now

- The repository exists publicly at `https://github.com/fol2/gptpro-gh-workbench`.
- Remote `main` contains the portal foundation and secure-cookie hotfix.
- The portal is reachable at `https://gptpro-gh-workbench.eugnel.uk/` through a Cloudflare Workers route.
- The portal requires a valid workbench session token before dashboard or API data is returned.
- The signed dashboard sets a `gptpro_workbench_session` cookie with `HttpOnly`, `SameSite=Strict`, and `Secure`.
- Dashboard JSON endpoint links preserve the signed-session query so a URL-first client can inspect them without immediately dropping auth.
- `GET /api/status` reports the portal as a read-only foundation and exposes deployment status from `WORKBENCH_DEPLOYMENT_STATUS`.
- `GET /api/github/repo` reads public metadata for `fol2/ks2-mastery` and returns `default_branch: main`.
- Unauthenticated requests to the status API return `401`.
- Official Worker secrets are set for `WORKBENCH_SESSION_TOKEN` and `WORKBENCH_DEPLOYMENT_STATUS`.
- GitHub write access is not connected yet; future branch, PR, issue, comment, or merge actions require a scoped GitHub token in the private executor layer.

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

## Merged Pull Requests

- PR #1: planning report merged to `main`.
- PR #2: Cloudflare portal foundation merged to `main`.
  - Merge commit: `f7c6dbb026299e0d09da5dddcc7ca1b9b3314561`
- PR #3: secure session cookie hotfix merged to `main`.
  - Merge commit: `fed2b4126527d53b44fdb4d13ebbf5a492c5ba50`

## Runtime Architecture

The current runtime is:

```text
ChatGPT / browser
  -> https://gptpro-gh-workbench.eugnel.uk/
  -> Cloudflare DNS
  -> Cloudflare Workers route: gptpro-gh-workbench.eugnel.uk/*
  -> Worker script: gptpro-gh-workbench
  -> fixed GitHub REST API reads for fol2/ks2-mastery
```

This is now a Cloudflare Workers route deployment. It no longer depends on the local Mac, `tmux`, a local Wrangler dev process, or a running `cloudflared` tunnel for the public URL.

Local operational files kept for recovery and session URL reference:

```text
~/.config/gptpro-gh-workbench/session-token
~/.config/gptpro-gh-workbench/session-url.txt
```

The Worker-side session secret is stored in Cloudflare as `WORKBENCH_SESSION_TOKEN`. The local token file is only a local reference for the signed URL and should not be committed.

The earlier tunnel fallback used a short-lived local env file:

```text
~/.config/gptpro-gh-workbench/workbench.env
```

It is no longer required for the public URL, but remains useful if a local fallback must be restarted.

## Live Smoke Evidence

Latest live-smoke result after official Worker route deployment and after stopping the local tunnel/runtime fallback:

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

## Verification Commands

Across the implementation and hotfix PRs, the following checks passed:

```sh
npm test
npm run check
git diff --check origin/main...HEAD
npm audit --omit=dev
npm audit --audit-level=high
```

Final `main` verification after PR #3:

```text
npm test: 14/14 passed
npm run check: passed
```

Independent reviewers also ran targeted curl and Wrangler dry-run checks. The final security review for PR #2 found no blockers, and the PR #3 hotfix review found no blockers.

## Security Boundaries

Confirmed boundaries in the current implementation:

- No direct pushes to `main` were used for product changes.
- No GitHub token is accepted by the portal.
- No GitHub token is echoed by the portal.
- No repository write operation is enabled.
- No shell, subprocess, or executor command path exists.
- No arbitrary URL fetch path exists.
- GitHub API reads are fixed to `https://api.github.com/repos/fol2/ks2-mastery`.
- Session gating happens before dashboard/API data routes.
- Read-only CORS is enabled without credentials.
- GitHub upstream failures are not returned as false HTTP 200 success responses.
- `workers_dev` is disabled in the Worker config.

The main residual exposure is capability-related rather than deployment-related: the current Worker is intentionally read-only, so the future GitHub write/executor layer still needs a scoped credential and its own audit boundary.

## GitHub Write-Access Blocker

Cloudflare deployment is complete. The remaining blocker for the broader "ChatGPT interacts with GitHub" vision is GitHub write access.

Cloudflare authentication and GitHub authentication are separate:

- Cloudflare auth deploys and configures the Worker.
- GitHub auth is required before an executor can create branches, push commits, open PRs, comment on PRs/issues, or merge.

The preferred credential is a GitHub App installation token scoped only to the required repository and permissions. The short-term alternative is a fine-grained PAT scoped only to the target repository. It should be exposed to the private executor as `GH_TOKEN` or `GITHUB_TOKEN`; it should not be embedded in the Git remote URL, committed to the repository, or returned by the public Worker.

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
```

## Recommended Next Step

The next engineering slice should connect a private executor behind a narrow action broker. It should preserve the current public contract:

- URL-first dashboard and JSON status remain browser-readable after session auth.
- No generic shell or arbitrary proxy is introduced.
- GitHub actions are allowlisted.
- GitHub write credentials stay outside the public Worker.
- Every state-changing action has explicit audit output and an approval boundary.

Before that slice can perform write actions, provide either a scoped GitHub App installation token or a fine-grained PAT for the private executor.

## Bottom Line

The project is real, public, merged, deployed, and reachable through a working Cloudflare Workers URL. The current live URL is a safe read-only workbench portal suitable for URL-first ChatGPT inspection. The private executor and GitHub write bridge are intentionally not connected yet; that next phase requires a scoped GitHub credential.
