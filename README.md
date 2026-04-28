# GPTPro GitHub Workbench

This repository captures the planning artefacts and first deployable Cloudflare Worker foundation for a URL-first GitHub workbench that ChatGPT can use through a constrained Cloudflare-protected portal.

The immediate target use case is KS2 Mastery (`fol2/ks2-mastery`): ChatGPT should reach a public URL, inspect a tightly scoped workbench state, and request allowlisted GitHub actions through a broker backed by a private executor. The portal is not a general shell, broad web proxy, or unrestricted GitHub proxy.

## Contents

- `src/worker.js` - session-protected Cloudflare Worker portal and narrow GitHub broker.
- `tests/worker.test.js` - Node built-in test coverage for routing, session/auth boundaries, GitHub reads, and allowlisted write safeguards.
- `wrangler.jsonc` - Cloudflare Worker configuration for `gptpro-gh-workbench`.
- `docs/plan/ks2-github-workbench-establishment-plan.md` - original establishment brief.
- `docs/plans/2026-04-28-001-feat-ks2-github-workbench-plan.md` - implementation plan for the URL-first portal/workbench direction.
- `@/2026-04-28-ks2-github-workbench-completion-report.md` - completion report for the planning artefact and recommended next implementation slice.
- `@/2026-04-28-gptpro-gh-workbench-deployment-report.md` - implementation, review, merge, and live-smoke report for the portal and write-broker slices.

## Current Status

The Cloudflare Worker portal foundation is implemented, merged to `main`, deployed through a Cloudflare Workers route, and live-smoked at `https://gptpro-gh-workbench.eugnel.uk/`. This branch adds the GitHub write-broker slice; the report should only be treated as final live evidence after the branch is merged, deployed, and smoked.

The Worker route is designed as a constrained GitHub workbench broker:

- `GET /` renders a compact browser dashboard.
- `GET /api/status` reports service, repository, capability, executor, auth/write, and allowlisted endpoint status.
- `GET /api/github/auth` reports token-backed identity, target repository permission, and broker capabilities without returning the token.
- `GET /api/github/repo` reads metadata for `fol2/ks2-mastery` through GitHub's REST API.
- `GET /api/github/prs?limit=N` lists public open pull requests with a conservative limit cap.
- `GET /api/github/issues?limit=N` lists public open issues and excludes pull requests where practical.
- `GET /api/actions` lists enabled read/write operations and disabled executor/admin operations.
- `POST /api/github/issues` creates an issue in `fol2/ks2-mastery`.
- `POST /api/github/comments` creates an issue or pull request comment by issue/PR number.
- `POST /api/github/branches` creates an `agent/...` branch from `main`.
- `POST /api/github/files` creates or updates one repository file on an `agent/...` branch.
- `POST /api/github/pulls` creates a pull request from an `agent/...` branch into `main`.

The private executor is still not connected: the Worker does not run shell commands, local tests, arbitrary Git operations, or repo-native scripts. GitHub writes are limited to fixed REST API operations against `fol2/ks2-mastery` using the Worker secret `GH_TOKEN`.

## Local Development

Install dependencies when you need Wrangler locally:

```sh
npm install
```

Run the Worker locally:

```sh
npm run dev -- --var WORKBENCH_SESSION_TOKEN:dev-session
```

Run tests and static checks:

```sh
npm test
npm run check
git diff --check
```

## Deployment

The Worker configuration uses:

- Worker name: `gptpro-gh-workbench`
- Main entry: `src/worker.js`
- Compatibility date: `2026-04-28`
- `workers_dev`: disabled
- Worker route: `gptpro-gh-workbench.eugnel.uk/*`

Deploy to Cloudflare Workers:

```sh
npm run deploy
```

The Worker requires `WORKBENCH_SESSION_TOKEN` as a secret. Open the portal with either a short-lived `?session=...` link or a `gptpro_workbench_session` cookie matching that secret.

GitHub write endpoints require `GH_TOKEN` as a Worker secret. The token must not be committed, sent to the browser, placed in a Git remote URL, or included in API responses.

Set `WORKBENCH_DEPLOYMENT_STATUS` to the current deploy state, either as a Worker variable or secret. Leave it unset before deployment; after a successful deploy and live smoke, set it to a concrete value such as `worker route live-smoked on 2026-04-28`.

`WORKBENCH_DEPLOYMENT_STATUS` should be updated after each successful deploy and live smoke.

## Security Boundaries

- No secrets are stored in code or configuration.
- No GitHub token, write credential, or executor credential is accepted from callers, echoed, or returned by the Worker.
- A valid workbench session token is required before the dashboard or API endpoints return data.
- The GitHub API base is fixed to `https://api.github.com/repos/fol2/ks2-mastery`.
- Write endpoints reject direct `main` writes, non-`agent/...` branches, workflow file edits, path traversal, oversized bodies, and non-JSON requests.
- There is no arbitrary URL fetch, generic proxy, shell execution, executor command execution, merge endpoint, admin endpoint, secret endpoint, or workflow endpoint.
- API responses include conservative security headers and CORS without credentials.
