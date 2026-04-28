# KS2 REST Broker Runtime Test Report

Date: 2026-04-28
Project repository: `fol2/gptpro-gh-workbench`
Default target repository: `fol2/ks2-mastery`
Allowlisted repositories: `fol2/ks2-mastery`, `fol2/gptpro-gh-workbench`
Broker URL: `https://gptpro-gh-workbench.eugnel.uk/`

## Summary

The broker appears correctly built and deployed as a constrained Cloudflare Worker for allowlisted repositories, but this runtime could not operate it end-to-end. The confirmed blocker was the client path from the current session to the broker, not the GitHub token held by the Worker.

## Confirmed

- The public portal exists behind a session boundary.
- Opening the public portal without a valid session returns `401 Unauthorized`, which is the expected unauthenticated boundary.
- Repository documentation describes a fixed-target broker for `fol2/ks2-mastery`, not a generic shell or arbitrary GitHub proxy.
- The deployed broker was previously live-smoked for authenticated status, auth, repo reads, branch/file/PR creation, and manual cleanup of a temporary KS2 smoke PR.

## Blocked From This Runtime

- Shell DNS resolution for `gptpro-gh-workbench.eugnel.uk` failed in the tested session.
- No signed workbench session URL was available in that chat.
- No POST-capable REST connector was exposed to that runtime.
- Browser-style GET/open checks were available, but arbitrary POST requests for branch/file/PR creation were not.

## Current Broker Capability Model

Capable of:

- Read status/auth/repo/issues/PRs for allowlisted repositories.
- Create an issue.
- Comment on an issue or PR number.
- Create an `agent/...` branch.
- Create or update one file on an `agent/...` branch.
- Open a PR from an `agent/...` branch.
- Close a temporary PR by number.
- Delete a validated `agent/...` branch for cleanup.
- Squash-merge an open, non-draft `agent/...` PR into an allowlisted repository's `main` when explicitly called with a PR number and optional expected head SHA.

Not yet capable of:

- Clone or pull a local repository checkout.
- Run local tests or repo-native scripts.
- Review PR diffs through a local checkout.
- Submit formal PR review state such as approve or request changes.
- Merge arbitrary, draft, closed, forked, or non-`agent/...` pull requests.

## Required Client Capability

The next runtime needs exactly one of these client paths:

- A signed workbench session URL plus an HTTP client path that can perform `GET` and `POST` requests to the broker.
- Shell DNS/HTTPS access to `gptpro-gh-workbench.eugnel.uk`, so `curl` or the probe client can call the broker.
- A platform REST/API connector exposed to the session.

Do not provide a GitHub token to the runtime. The Worker already holds its GitHub credential as a secret. The runtime only needs workbench session capability.

## Recommended Probe Flow

Run the read-only probe first after exposing a signed workbench session URL through a session-scoped environment variable.

Only run write smoke after the cleanup endpoints are deployed and authenticated. The write smoke should create a temporary PR and branch, then close the PR and delete the branch before reporting success.

## Evidence Handling

The companion log file in this repository is a redacted summary, not a raw capture. Raw logs can contain bearer-style session URLs or cookies and must not be committed unless they have been reviewed and redacted.
