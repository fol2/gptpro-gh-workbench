---
title: "KS2 GitHub workbench planning completion report"
type: completion-report
status: completed-planning-artefact
date: 2026-04-28
repository: fol2/gptpro-gh-workbench
project_repository: fol2/gptpro-gh-workbench
target_repository: fol2/ks2-mastery
source_plan: docs/plans/2026-04-28-001-feat-ks2-github-workbench-plan.md
origin_brief: docs/plan/ks2-github-workbench-establishment-plan.md
---

# KS2 GitHub workbench planning completion report

## Executive summary

The KS2 GitHub workbench establishment artefact is now documented as a completed planning outcome. It defines the intended operating model for `fol2/ks2-mastery`: a URL-first Cloudflare portal that ChatGPT can open and use as a constrained proxy into a GitHub-capable workbench, with the private shell checkout acting as the executor behind that URL.

The key correction is explicit in the plan and carried through this report: the portal is not an optional presentation layer. The portal URL is the primary ChatGPT-facing interface. A shell checkout with `git`, `gh`, `node`, and `npm` remains essential, but it is the private executor, not the user-facing contract.

This report does not claim that the portal, Cloudflare routing, authentication policy, private executor, or broker API have already been deployed. It documents that the planning and establishment direction has been completed, reconciled against the original workbench brief, and is ready to drive the next implementation slice.

## Objective

The objective is to give ChatGPT a safe, repeatable way to interact with GitHub for the KS2 Mastery repository through a reachable URL. The workbench should allow read, review, branch, commit, PR, issue, and verification workflows when explicitly authorised, while preventing broad shell, merge, admin, secret, deployment, or repository-settings authority by default.

In practical terms, the target system is:

- A protected Cloudflare URL under a managed domain such as `eugnel.uk` or `eugnel.com`.
- A constrained portal and broker that ChatGPT can navigate through browser-usable pages and, where available, structured JSON endpoints.
- A private executor with a real `fol2/ks2-mastery` checkout, `git`, `gh`, `node`, and `npm`.
- Narrow GitHub authentication through short-lived, repo-scoped credentials.
- Explicit approval gates and audit records for state-changing work.

## What the planning artefact established

The origin brief established the non-negotiable access contract: a remote VM or hidden workspace is not useful unless the assistant can operate it through an exposed route. The route must be one of a network-enabled shell checkout, a mounted working directory, or a narrow GitHub bridge with callable repository operations.

The completed implementation plan adds the missing product shape: the workbench must expose a URL that ChatGPT can use as the front door. The plan therefore establishes the Cloudflare portal as the primary interface, with shell and GitHub tooling behind it.

The plan also establishes these operating contracts:

- `KS2_REPO='fol2/ks2-mastery'` and `KS2_REPO_DIR='/mnt/data/work/ks2-mastery'` as the executor checkout contract.
- Non-interactive Git and GitHub CLI behaviour via `GIT_TERMINAL_PROMPT=0` and `GH_NO_UPDATE_NOTIFIER=1`.
- Required tools: `git`, `curl`, `jq`, `gh`, `node`, and `npm`, with `rg` and `python3` as practical supporting tools.
- Required GitHub network reachability for `github.com`, `api.github.com`, `raw.githubusercontent.com`, `codeload.github.com`, and `objects.githubusercontent.com`.
- GitHub Meta API usage for current network metadata rather than hardcoded, stale allowlist data.
- Fast-forward-only `main` refreshes.
- A reversible branch and PR smoke test only after explicit user approval.
- A fallback path through a Git bundle or narrow bridge when shell network access is blocked.

## URL-first Cloudflare portal direction

The URL-first direction is the central architectural decision. ChatGPT needs a reachable portal URL so it can inspect status, navigate issues and PRs, view diffs, submit proposed actions, and receive results. The portal is therefore mandatory for the target workbench, not an optional dashboard added after the shell works.

The intended Cloudflare shape is:

- A dedicated hostname under `eugnel.uk` or `eugnel.com`.
- Cloudflare Access, service-token controls, signed sessions, or an equivalent protected access model.
- Browser-usable flows for ChatGPT contexts that cannot attach custom headers.
- Structured JSON endpoints for clients that can make authenticated API requests.
- Redacted status, capability, PR, issue, diff, proposal, approval, and job-result views.

The portal must behave as a constrained broker. It must not become a generic shell, arbitrary command runner, arbitrary web proxy, broad GitHub proxy, or unauthenticated public control surface.

## Private executor role

The private executor is the part of the system that can do real repository work. It owns the checkout, local Git state, `gh` operations, repo-native scripts, and verification commands.

The planning artefact separates two capability layers:

| Layer | Suitable work | Unsuitable work |
|---|---|---|
| Cloudflare Worker or edge broker | GitHub API reads, issue/PR metadata, simple write proposals, status pages, authenticated routing | Local `git`, `npm test`, `npm run check`, filesystem-backed diff generation, full checkout verification |
| Private executor | Clone, fetch, branch, commit, push, PR creation, PR review preparation, local tests, repo-specific scripts | Direct public exposure, browser-visible secrets, unapproved arbitrary commands |

The recommended topology is a protected Cloudflare front door plus either an outbound polling executor or a Cloudflare Tunnel-protected private origin. This keeps the workbench reachable to ChatGPT through a URL while avoiding inbound public shell access.

## GitHub authentication and permission model

The plan uses the narrowest credential that can perform the requested work.

Preferred authentication:

- GitHub App installation token scoped to `fol2/ks2-mastery`.
- Repository-limited, short-lived, and permission-specific.
- Installation access tokens should be treated as time-limited credentials and rotated naturally by the issuer.

Fallback authentication:

- Short-lived fine-grained PAT scoped only to `fol2/ks2-mastery`.
- Granted only the repository permissions needed for the current tier.

The token handling rules are strict:

- Expose credentials only as `GH_TOKEN` or `GITHUB_TOKEN`.
- Do not store tokens in the repository.
- Do not embed tokens in Git remotes.
- Do not print tokens in logs, portal pages, API responses, PR bodies, or audit records.
- Revoke or rotate credentials once the workbench is no longer needed.

The permission tiers are:

| Tier | Capability | Default posture |
|---|---|---|
| Tier 0 | Read-only clone and test | Safe baseline when public read or metadata/content read is available |
| Tier 1 | Issue/PR triage and comments | Requires metadata read plus issues and pull requests write |
| Tier 2 | Branch push and PR creation | Requires contents write and pull requests write |
| Tier 3 | Workflow edits | Requires workflows write and explicit workflow scope |
| Tier 4 | Merge, deploy, or admin actions | Disabled by default; only for a named, user-approved action |

## Safety boundaries

The safety model is deliberately conservative because the portal introduces a URL-accessible control plane.

Allowed by default:

- Clone, fetch, inspect, search, and run local tests.
- Create local branches.
- Prepare patches, diffs, reports, and PR bodies.
- Create issues or PRs only when explicitly asked.
- Post PR review comments only when explicitly asked.

Disallowed by default:

- Merge PRs.
- Push directly to `main`.
- Force-push shared branches.
- Modify repository settings, branch protection, secrets, deployments, billing, or Cloudflare deployment state.
- Create workflow changes unless the task explicitly includes CI or workflow work.
- Expose arbitrary shell execution through the portal.
- Expose arbitrary filesystem reads through the portal.
- Expose a general-purpose outbound web proxy.
- Return secrets, full environment variables, token-bearing paths, or unrelated private branch data.

State-changing portal actions should require explicit approval, idempotency keys, and audit entries containing actor, repository, branch, requested operation, result, and created GitHub URLs or IDs.

## SDLC and review workflow alignment

The workbench direction aligns with the existing KS2 PR-first delivery pattern:

1. Refresh from `main` with fast-forward-only behaviour.
2. Create a task branch.
3. Make the smallest reviewable change.
4. Run appropriate local verification.
5. Commit with a concise UK English message.
6. Push the branch.
7. Open a PR against `fol2/ks2-mastery:main`.
8. Review, update, and verify before merge.
9. Merge only when James explicitly authorises a specific PR.

The portal should preserve this workflow rather than bypass it. For example, a ChatGPT request to create a branch or PR should become a proposal or queued executor job with visible diff, verification output, and approval status. It should not silently mutate `main` or perform privileged operations just because the token technically can.

For review work, the bridge should support PR metadata, diffs, comments, and review bodies. It should not approve, request changes, merge, or alter branch protection unless the user explicitly requests that exact action and the permission tier has been deliberately enabled.

## Acceptance criteria

### Planning artefact acceptance

This completion report treats the planning artefact as complete when:

- The origin workbench brief has been read and reconciled.
- The 2026-04-28 implementation plan has been read and summarised.
- The KS2 repository instructions have been read and honoured.
- The URL-first Cloudflare portal/proxy direction is documented as required, not optional.
- The private executor role is distinguished from edge-only GitHub API brokering.
- Authentication, permission tiers, safety boundaries, review workflow, risks, and next slice are documented.
- Claims stay precise: the plan is complete, but the portal is not claimed as deployed.

### Future implementation acceptance

The actual workbench should not be called ready until it can prove:

- The portal hostname resolves through Cloudflare and is protected by the chosen access policy.
- ChatGPT can open the portal URL and complete at least one scoped read operation.
- Unauthenticated callers receive no workbench status and no secret-bearing detail.
- The private executor can report its checkout path, current commit, remote `HEAD`, and clean branch state.
- `git pull --ff-only origin main` works in the executor checkout.
- GitHub API and `gh` can read repository identity, default branch, issues, and PRs.
- The observed permission tier is reported as read-only, triage-ready, branch/PR-ready, workflow-edit-ready, or admin-disabled.
- Write readiness is proven only through a reversible, user-approved smoke branch and PR lifecycle.
- Smoke PRs and branches are closed or deleted after verification.
- Portal logs can reconstruct requested, approved, executed, and rejected actions.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Portal is mistaken for an already deployed system | Label this as a completed planning artefact only; require live portal evidence before claiming deployment. |
| Worker-only portal is mistaken for full workbench capability | Report edge-only and executor-backed capabilities separately. Local verification requires the private executor. |
| Token is too broad or long-lived | Prefer GitHub App installation tokens; otherwise use short-lived fine-grained PATs scoped to `fol2/ks2-mastery`. |
| Token leaks through portal or logs | Keep credentials in `GH_TOKEN` or `GITHUB_TOKEN`, Cloudflare Worker secrets, or executor environment only; redact all outputs. |
| ChatGPT cannot send Cloudflare Access service-token headers | Provide a browser-usable signed-session or Access flow in addition to API-oriented service-token access. |
| URL session becomes a bearer secret | Make signed sessions short-lived, repo-scoped, capability-scoped, revocable, and insufficient for unapproved writes. |
| Arbitrary shell access slips into the broker | Maintain an allowlisted operation model and route local commands through approved executor jobs only. |
| Duplicate writes happen on retry | Require idempotency keys for branch, commit, PR, issue, review, and cleanup operations. |
| Local `main` diverges | Use fast-forward-only pulls and fail loudly rather than merging or rebasing. |
| Write smoke leaves clutter | Use a clearly named temporary branch/PR, record created URLs, and require cleanup evidence. |
| Upstream branch push is denied | Use a fork fallback while still opening PRs against `fol2/ks2-mastery:main`. |
| GitHub network allowlists drift | Query GitHub Meta API for current service metadata. |
| Merge or deployment capability is accidentally enabled | Keep Tier 4 disabled by default and require explicit approval for a named action. |

## Recommended next implementation slice

The next slice should be a minimal, reviewable portal foundation that proves the URL-first contract without enabling broad write authority.

Recommended scope:

- Choose the exact Cloudflare hostname under `eugnel.uk` or `eugnel.com`.
- Implement a protected portal shell with human-readable status and equivalent JSON status.
- Add authentication enforcement and redacted error handling before adding GitHub write paths.
- Expose read-only KS2 repository metadata through the portal: repo name, default branch, executor readiness state, current executor commit, and observed permission tier.
- Add the private executor handshake: the portal should show whether executor-backed checkout operations are available, degraded, or offline.
- Add an allowlisted operation registry and audit schema, even if the first slice only supports read-only operations.
- Add explicit "pending approval" modelling for future writes, but do not execute branch, commit, push, PR, review, merge, or deployment actions in this first slice.

Acceptance for that slice should be:

- ChatGPT can open the protected URL and inspect KS2 workbench status.
- An unauthenticated request is denied without leaking implementation detail.
- The status clearly distinguishes portal availability, GitHub API availability, and private executor availability.
- No GitHub token is visible in browser JavaScript, local storage, query strings, HTML, JSON, logs, or error messages.
- The code path has a clear extension point for approval-gated branch/PR actions in the following slice.

The slice after that should add one approval-gated, idempotent, reversible write path, such as a smoke branch and PR lifecycle. Merge, deploy, repo settings, secrets, and workflow edits should remain out of scope.

## Evidence and source references

This report is stored in the separate `fol2/gptpro-gh-workbench` project and is based on these source artefacts:

- `docs/plan/ks2-github-workbench-establishment-plan.md`
- `docs/plans/2026-04-28-001-feat-ks2-github-workbench-plan.md`
- `AGENTS.md`

The most important source facts carried forward are:

- The original workbench contract requires an actually operable assistant route: shell network, mounted checkout, or narrow bridge.
- The implementation plan upgrades the target to a URL-first Cloudflare portal/proxy that ChatGPT can use directly.
- The portal must be constrained and protected, not a general shell or proxy.
- The private executor is required for local checkout, Git, Node, and repo verification work.
- GitHub auth should be minimal, short-lived, repo-scoped, and never embedded in remotes or files.
- Merge, deployment, settings, secrets, billing, and workflow capability remain disabled unless James explicitly approves a named action.

## Caveat

This report closes the planning and documentation step only. The Cloudflare portal, access policy, broker endpoints, private executor, GitHub credential issuer, and live readiness checks still need to be implemented and verified before the KS2 GitHub workbench can be described as deployed or operational.
