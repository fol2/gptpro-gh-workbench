# KS2 Workbench Broker Retry Test — 2026-04-28

## Result

The live broker is visible to the browser/web layer and the public repository confirms the updated broker design, including the signed-session probe client and cleanup endpoints. However, this ChatGPT runtime is still not operable against the broker end-to-end.

## What was tested

### 1. Environment variable presence

Command:

```bash
[ -n "${KS2_WORKBENCH_SESSION_URL:-}" ] && echo present || echo missing
[ -n "${KS2_WORKBENCH_SESSION_TOKEN:-}" ] && echo present || echo missing
```

Observed:

```text
KS2_WORKBENCH_SESSION_URL=missing
KS2_WORKBENCH_SESSION_TOKEN=missing
```

### 2. Shell network path to broker

Command:

```bash
curl -svI --connect-timeout 3 --max-time 6 https://gptpro-gh-workbench.eugnel.uk/
```

Observed:

```text
curl_exit=6
Could not resolve host: gptpro-gh-workbench.eugnel.uk
```

So the shell path still has DNS failure for the broker domain.

### 3. Local probe script

The older local copy at `/mnt/data/ks2_workbench_broker_probe.py` does not match the updated repo version. It lacks `--json` and cleanup support.

Running with normal `python3` also hung because this runtime's Python site startup hangs. Running with `python3 -S` avoids that issue.

Command:

```bash
python3 -S /mnt/data/ks2_workbench_broker_probe.py
```

Observed:

```text
ERROR: Set KS2_WORKBENCH_SESSION_URL or KS2_WORKBENCH_SESSION_TOKEN.
exit=2
```

### 4. Browser/web path

The web layer can reach the broker root and receives `401 Unauthorized` without a session, which is the intended unauthenticated boundary.

The public `fol2/gptpro-gh-workbench` repo confirms the Worker exposes the expected read endpoints, issue/comment/branch/file/PR write endpoints, and cleanup endpoints for close/delete.

## Current blocker

The broker itself appears ready, but this specific assistant session lacks both:

1. the signed session URL as `KS2_WORKBENCH_SESSION_URL`, and
2. a shell DNS/HTTPS route to `gptpro-gh-workbench.eugnel.uk`.

Without those, I cannot run:

```bash
python3 docs/ks2_workbench_broker_probe.py --json
```

nor:

```bash
python3 docs/ks2_workbench_broker_probe.py --write-smoke --json
```

## What needs to change

For this exact environment, inject a session-scoped variable and make the shell route resolve the broker domain:

```bash
export KS2_WORKBENCH_SESSION_URL='https://gptpro-gh-workbench.eugnel.uk/?session=...'
```

Then the probe should be run as:

```bash
python3 -S docs/ks2_workbench_broker_probe.py --json
```

The `-S` flag is only a workaround for this container's current Python site-startup hang.

## Verdict

Not broker-ready from this runtime yet.

Classification: `missing_session_url` plus `dns_failure` on the shell client path.
