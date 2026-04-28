# GPTPro GitHub Workbench

This repository captures the planning artefacts and first deployable Cloudflare Worker foundation for a URL-first GitHub workbench that ChatGPT can use through a constrained Cloudflare-protected portal.

The immediate target use case is KS2 Mastery (`fol2/ks2-mastery`), with this workbench repository (`fol2/gptpro-gh-workbench`) also allowlisted for broker-maintenance work. ChatGPT should reach a public URL, inspect a tightly scoped workbench state, and request allowlisted GitHub actions through a broker backed by a private executor. The portal is not a general shell, broad web proxy, or unrestricted GitHub proxy.

## Contents

- `src/worker.js` - session-protected Cloudflare Worker portal and narrow GitHub broker.
- `tests/worker.test.js` - Node built-in test coverage for routing, session/auth boundaries, GitHub reads, and allowlisted write safeguards.
- `tests/workbench_docs.test.js` - documentation secret-scan and capability wording checks.
- `tests/broker_probe_test.py` - Python unit coverage for the reusable broker probe client.
- `wrangler.jsonc` - Cloudflare Worker configuration for `gptpro-gh-workbench`.
- `docs/ks2_workbench_broker_probe.py` - dependency-light probe client for signed workbench session URLs.
- `docs/ks2-rest-broker-test-report-2026-04-28.md` - runtime test report and client-path blocker summary.
- `docs/plan/ks2-github-workbench-establishment-plan.md` - original establishment brief.
- `docs/plans/2026-04-28-001-feat-ks2-github-workbench-plan.md` - implementation plan for the URL-first portal/workbench direction.
- `docs/plans/2026-04-28-002-feat-operable-broker-client-plan.md` - implementation plan for the operable client path and cleanup slice.
- `@/2026-04-28-ks2-github-workbench-completion-report.md` - completion report for the planning artefact and recommended next implementation slice.
- `@/2026-04-28-gptpro-gh-workbench-deployment-report.md` - implementation, review, merge, and live-smoke report for the portal and write-broker slices.

## Current Status

The Cloudflare Worker portal and GitHub write-broker slice are implemented, merged to `main`, deployed through a Cloudflare Workers route, and live-smoked at `https://gptpro-gh-workbench.eugnel.uk/`.

The Worker route is a constrained GitHub workbench broker. The default target remains `fol2/ks2-mastery`; callers can select `fol2/gptpro-gh-workbench` with `repo=fol2/gptpro-gh-workbench` for read endpoints or `"repo": "fol2/gptpro-gh-workbench"` in write JSON bodies.

- `GET /` renders a compact browser dashboard.
- `GET /api/status` reports service, repository, capability, executor, auth/write, and allowlisted endpoint status.
- `GET /api/github/auth` reports token-backed identity, selected target repository permission, and broker capabilities without returning the token.
- `GET /api/github/repo` reads metadata for an allowlisted repository through GitHub's REST API.
- `GET /api/github/prs?limit=N` lists public open pull requests for an allowlisted repository with a conservative limit cap.
- `GET /api/github/issues?limit=N` lists public open issues for an allowlisted repository and excludes pull requests where practical.
- `GET /api/actions` lists enabled read/write operations and disabled executor/admin operations.
- `POST /api/github/issues` creates an issue in an allowlisted repository.
- `POST /api/github/comments` creates an issue or pull request comment by issue/PR number.
- `POST /api/github/branches` creates an `agent/...` branch from `main`.
- `POST /api/github/branches/delete` deletes a validated `agent/...` branch ref for smoke cleanup.
- `POST /api/github/files` creates or updates one repository file on an `agent/...` branch.
- `POST /api/github/pulls` creates a pull request from an `agent/...` branch into `main`.
- `POST /api/github/pulls/close` closes a pull request by number for smoke cleanup.
- `POST /api/github/pulls/merge` squash-merges an open, non-draft `agent/...` pull request into `main` after validating the target repository, base branch, and optional expected head SHA.

The private executor is still not connected: the Worker does not run shell commands, local tests, arbitrary Git operations, or repo-native scripts. GitHub writes are limited to fixed REST API operations against allowlisted repositories using the Worker secret `GH_TOKEN`.

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

Probe the live broker from a runtime that has a signed workbench session URL:

```sh
export KS2_WORKBENCH_SESSION_URL='<signed workbench session URL>'
python3 docs/ks2_workbench_broker_probe.py
```

The default probe is read-only. The optional write smoke creates a temporary `agent/...` branch, writes a harmless smoke file, opens a temporary PR, closes that PR, and deletes the branch:

```sh
python3 docs/ks2_workbench_broker_probe.py --write-smoke
```

To authorise a guarded broker merge, give the agent the signed session URL and a specific PR number. The merge endpoint is intentionally narrow:

```sh
python3 docs/ks2_workbench_broker_probe.py --merge-pr 494 --expected-head-sha '<40-character-head-sha>'
```

To target this workbench repository instead of the default KS2 repository, pass `--repo fol2/gptpro-gh-workbench`:

```sh
python3 docs/ks2_workbench_broker_probe.py --repo fol2/gptpro-gh-workbench --json
python3 docs/ks2_workbench_broker_probe.py --repo fol2/gptpro-gh-workbench --merge-pr 10 --expected-head-sha '<40-character-head-sha>' --json
```

The broker defaults to a squash merge and accepts only open, non-draft `agent/...` pull requests targeting an allowlisted repository's `main` branch.

Do not provide or export a GitHub token to the probe runtime. The Worker already holds GitHub authority through its own secret.

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
- The GitHub API base is fixed to allowlisted repositories only: `fol2/ks2-mastery` and `fol2/gptpro-gh-workbench`.
- Write endpoints reject direct `main` file writes, non-`agent/...` branches, workflow file edits, path traversal, oversized bodies, and non-JSON requests.
- Cleanup endpoints are limited to closing pull requests by number and deleting validated `agent/...` branch refs; they do not expose generic Git reference management.
- Merge authority is limited to open, non-draft `agent/...` pull requests from an allowlisted repository into that repository's `main`, using squash merge only. Callers can pin `expectedHeadSha` to reject stale merges.
- There is no arbitrary URL fetch, generic proxy, shell execution, executor command execution, direct-main file write endpoint, admin endpoint, secret endpoint, or workflow endpoint.
- API responses include conservative security headers and CORS without credentials.
