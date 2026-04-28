# KS2 Workbench Broker Probe Retest — 2026-04-28

## File

`/mnt/data/ks2_workbench_broker_probe.py` is present.

## CLI contract grep

Exit code: `0`

```text
266:        "classification": "broker_read_ready",
447:def run_merge_pr(
529:    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
532:    action.add_argument("--merge-pr", type=int, help="Squash-merge one guarded agent PR by number.")
533:    parser.add_argument("--expected-head-sha", help="Required 40-character head SHA guard for --merge-pr.")
534:    parser.add_argument("--merge-title", help="Optional commit title for --merge-pr.")
535:    parser.add_argument("--merge-message", help="Optional commit message for --merge-pr.")
```

## Help output

```text
usage: ks2_workbench_broker_probe.py [-h] [--session-url SESSION_URL]
                                     [--session-url-file SESSION_URL_FILE]
                                     [--timeout TIMEOUT] [--repo REPO]
                                     [--session-auth {query,header}] [--json]
                                     [--write-smoke | --merge-pr MERGE_PR]
                                     [--expected-head-sha EXPECTED_HEAD_SHA]
                                     [--merge-title MERGE_TITLE]
                                     [--merge-message MERGE_MESSAGE]

Probe the session-protected KS2 GitHub workbench broker.

options:
  -h, --help            show this help message and exit
  --session-url SESSION_URL
                        Signed workbench session URL. Prefer the environment
                        variable.
  --session-url-file SESSION_URL_FILE
                        File containing a signed workbench session URL.
  --timeout TIMEOUT     HTTP timeout in seconds.
  --repo REPO           Allowed target repo. Defaults to the broker default
                        target.
  --session-auth {query,header}
                        Send the workbench session as the URL query parameter
                        or X-Workbench-Session header.
  --json                Print machine-readable JSON.
  --write-smoke         Run an opt-in branch/file/PR write smoke.
  --merge-pr MERGE_PR   Squash-merge one guarded agent PR by number.
  --expected-head-sha EXPECTED_HEAD_SHA
                        Required 40-character head SHA guard for --merge-pr.
  --merge-title MERGE_TITLE
                        Optional commit title for --merge-pr.
  --merge-message MERGE_MESSAGE
                        Optional commit message for --merge-pr.
```

## Session availability

```text
KS2_WORKBENCH_SESSION_URL=
KS2_WORKBENCH_SESSION_TOKEN=
KS2_WORKBENCH_BASE=
/home/oai/.config/gptpro-gh-workbench/session-url.txt=missing
/mnt/data/ks2_workbench_session_url.txt=missing
/mnt/data/.ks2_workbench_session_url=missing
/mnt/data/workbench_session_url.txt=missing
/mnt/data/session_url.txt=missing
```

## Requested command

```bash
python3 -S /mnt/data/ks2_workbench_broker_probe.py --json
```

Exit code: `1`

```json
{
  "checks": [],
  "classification": "missing_session_url",
  "message": "Missing signed workbench session URL. Set KS2_WORKBENCH_SESSION_URL or pass --session-url.",
  "ok": false
}
```

## Conclusion

The uploaded probe file now matches the required CLI contract, but this same runtime still has no signed workbench session URL. The read probe therefore returns `missing_session_url`, not `broker_read_ready`. No broker call, write smoke, or merge was attempted.

## Follow-up Action Path

The repo now defines a ChatGPT Pro API connector/action path as the preferred durable route. The action should call the hosted broker directly, keep session material out of model-visible arguments, and authenticate action-to-broker requests with:

```text
X-Workbench-Session: <signed-session-token>
```

The first call remains a read gate:

```text
GET /api/action/readiness
```

Only continue when that response returns `classification: broker_read_ready`.

For shell fallback from a runtime that has broker network reachability, the probe can exercise the same header-auth boundary:

```bash
python3 -S docs/ks2_workbench_broker_probe.py --session-auth header --json
```
