# KS2 REST Broker Test Report — 2026-04-28

## Result

Partial test only.

I verified the public portal from the browser layer reaches the workbench and returns unauthenticated `401`, which matches the intended session boundary.

I could not complete authenticated GETs or any POST/write through the broker in this ChatGPT session because:

1. The local shell still cannot resolve `gptpro-gh-workbench.eugnel.uk`.
2. The local shell therefore cannot use `curl` for broker calls.
3. No signed workbench session URL/token was available in this session.
4. The browser tool can open GET URLs but does not provide arbitrary POST requests.
5. No REST/API connector was exposed to this session.

## Local shell probe evidence

From `/mnt/data/ks2_rest_broker_test_2026-04-28.log`:

```text
curl=/usr/local/bin/curl
jq=/usr/bin/jq
git=/usr/bin/git
gh=

## portal root unauth
curl: (6) Could not resolve host: gptpro-gh-workbench.eugnel.uk
http_code=000

## api status unauth retry with GNU timeout
curl: (6) Could not resolve host: gptpro-gh-workbench.eugnel.uk
http_code=000
curl_exit=6

## api github repo unauth retry with GNU timeout
curl: (6) Could not resolve host: gptpro-gh-workbench.eugnel.uk
http_code=000

## DNS probe via getent/nslookup/python
getent_hosts=getent_exit=2
python_getaddrinfo=gaierror:[Errno -3] Temporary failure in name resolution
```

## What I can verify from public repo/docs

The broker is designed as a session-protected Cloudflare Worker targeting `fol2/ks2-mastery`. It exposes fixed read endpoints and allowlisted write endpoints: issue creation, issue/PR comments, `agent/...` branch creation, single-file create/update on `agent/...` branches, and PR creation from `agent/...` branches.

The current broker intentionally does not expose shell execution, arbitrary Git operations, local tests, direct main writes, merge, repository admin, secrets, workflow-management, or generic URL proxying.

## Operational implication

In the current ChatGPT runtime I cannot yet create/update/review PRs through the broker. The broker itself may work, but I need one of these access paths:

- a signed workbench session URL plus an HTTP client in this runtime that can perform GET and POST to `https://gptpro-gh-workbench.eugnel.uk`, or
- working shell DNS/HTTPS to `gptpro-gh-workbench.eugnel.uk`, or
- a platform-provided REST/API connector exposed to this session.

Do not provide the GitHub token. The Worker already holds `GH_TOKEN`; I only need the workbench session capability.

## Reusable probe script

I created `/mnt/data/ks2_workbench_broker_probe.py`.

Read-only usage:

```bash
export KS2_WORKBENCH_SESSION_URL='https://gptpro-gh-workbench.eugnel.uk/?session=...'
python3 /mnt/data/ks2_workbench_broker_probe.py
```

Write smoke is opt-in and not reversible using the current broker alone:

```bash
python3 /mnt/data/ks2_workbench_broker_probe.py --write-smoke
```

The write smoke creates an `agent/rest-broker-smoke-*` branch, writes one `.agent-smoke/*` file, and opens a draft PR. Because the current broker has no close-PR/delete-branch endpoint, operator cleanup is required unless those endpoints are added.
