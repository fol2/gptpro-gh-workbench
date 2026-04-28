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

## Current Status

The Cloudflare Worker portal foundation is implemented but not deployed yet. It is intentionally read-only:

- `GET /` renders a compact browser dashboard.
- `GET /api/status` reports service, repository, capability, executor, auth/write, and allowlisted endpoint status.
- `GET /api/github/repo` reads public metadata for `fol2/ks2-mastery` through GitHub's REST API without a token.
- `GET /api/github/prs?limit=N` lists public open pull requests with a conservative limit cap.
- `GET /api/github/issues?limit=N` lists public open issues and excludes pull requests where practical.
- `GET /api/actions` lists enabled read operations and disabled write/executor operations.

The private executor, GitHub write authentication, secret handling, and state-changing actions are not connected in this slice.

## Local Development

Install dependencies when you need Wrangler locally:

```sh
npm install
```

Run the Worker locally:

```sh
npm run dev
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
- `workers_dev`: enabled
- Custom domain route candidate: `gptpro-gh-workbench.eugnel.uk`

Deploy once Cloudflare Wrangler authentication is working:

```sh
npm run deploy
```

Current blocker: Wrangler authentication was failing in the parent SDLC session, so this repository does not claim that the Worker is deployed or live on Cloudflare yet.

## Security Boundaries

- No secrets are stored in code or configuration.
- No token is accepted, echoed, or returned by the Worker.
- The GitHub API base is fixed to `https://api.github.com/repos/fol2/ks2-mastery`.
- There is no arbitrary URL fetch, generic proxy, shell execution, executor command execution, or GitHub write operation.
- API responses include conservative security headers and read-only CORS without credentials.
