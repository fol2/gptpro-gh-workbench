# GPTPro GitHub Workbench

This repository captures the planning artefacts and first deployable Cloudflare Worker foundation for a URL-first GitHub workbench that ChatGPT can use through a constrained Cloudflare-protected portal.

The immediate target use case is KS2 Mastery (`fol2/ks2-mastery`): ChatGPT should reach a public URL, inspect a tightly scoped workbench state, and request allowlisted GitHub actions through a broker backed by a private executor. The portal is not a general shell, broad web proxy, or unrestricted GitHub proxy.

## Contents

- `src/worker.js` - read-only Cloudflare Worker portal foundation.
- `tests/worker.test.js` - Node built-in test coverage for routing, status, action boundaries, and GitHub limit handling.
- `wrangler.jsonc` - Cloudflare Worker configuration for `gptpro-gh-workbench`.
- `docs/plan/ks2-github-workbench-establishment-plan.md` - original establishment brief.
- `docs/plans/2026-04-28-001-feat-ks2-github-workbench-plan.md` - implementation plan for the URL-first portal/workbench direction.
- `@/2026-04-28-ks2-github-workbench-completion-report.md` - completion report for the planning artefact and recommended next implementation slice.
- `@/2026-04-28-gptpro-gh-workbench-deployment-report.md` - implementation, review, merge, and live-smoke report for the portal foundation.

## Current Status

The Cloudflare Worker portal foundation is implemented, merged to `main`, deployed through a Cloudflare Workers route, and live-smoked at `https://gptpro-gh-workbench.eugnel.uk/`.

The live Worker route is intentionally read-only:

- `GET /` renders a compact browser dashboard.
- `GET /api/status` reports service, repository, capability, executor, auth/write, and allowlisted endpoint status.
- `GET /api/github/repo` reads public metadata for `fol2/ks2-mastery` through GitHub's REST API without a token.
- `GET /api/github/prs?limit=N` lists public open pull requests with a conservative limit cap.
- `GET /api/github/issues?limit=N` lists public open issues and excludes pull requests where practical.
- `GET /api/actions` lists enabled read operations and disabled write/executor operations.

The private executor, GitHub write authentication, secret handling, and state-changing actions are not connected in this slice.

GitHub write access is not connected in this slice. A scoped GitHub App installation token or fine-grained PAT is still required before the future private executor can create branches, PRs, issues, or comments.

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

Set `WORKBENCH_DEPLOYMENT_STATUS` to the current deploy state, either as a Worker variable or secret. Leave it unset before deployment; after a successful deploy and live smoke, set it to a concrete value such as `worker route live-smoked on 2026-04-28`.

Current GitHub write-access blocker: no scoped GitHub App installation token or fine-grained PAT has been connected to a private executor yet. The deployed Worker intentionally remains read-only.

## Security Boundaries

- No secrets are stored in code or configuration.
- No GitHub token, write credential, or executor credential is accepted, echoed, or returned by the Worker.
- A valid workbench session token is required before the dashboard or API endpoints return data.
- The GitHub API base is fixed to `https://api.github.com/repos/fol2/ks2-mastery`.
- There is no arbitrary URL fetch, generic proxy, shell execution, executor command execution, or GitHub write operation.
- API responses include conservative security headers and read-only CORS without credentials.
