#!/usr/bin/env python3
"""Probe the KS2 GPTPro GitHub Workbench REST broker.

Usage, read-only:
  export KS2_WORKBENCH_SESSION_URL='https://gptpro-gh-workbench.eugnel.uk/?session=...'
  python3 ks2_workbench_broker_probe.py

Alternative:
  export KS2_WORKBENCH_BASE='https://gptpro-gh-workbench.eugnel.uk'
  export KS2_WORKBENCH_SESSION_TOKEN='...'
  python3 ks2_workbench_broker_probe.py

Write smoke is intentionally opt-in and leaves an open PR/branch unless another
cleanup route or separate GitHub access is available:
  python3 ks2_workbench_broker_probe.py --write-smoke
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

READ_ENDPOINTS = [
    "/api/status",
    "/api/actions",
    "/api/github/auth",
    "/api/github/repo",
    "/api/github/prs?limit=5",
    "/api/github/issues?limit=5",
]

BASE_DEFAULT = "https://gptpro-gh-workbench.eugnel.uk"


def die(message: str, code: int = 2) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def parse_config() -> tuple[str, str]:
    session_url = os.environ.get("KS2_WORKBENCH_SESSION_URL", "").strip()
    if session_url:
        parsed = urllib.parse.urlparse(session_url)
        qs = urllib.parse.parse_qs(parsed.query)
        token_values = qs.get("session") or qs.get("token")
        if not token_values or not token_values[0]:
            die("KS2_WORKBENCH_SESSION_URL must include ?session=...")
        base = f"{parsed.scheme}://{parsed.netloc}"
        return base.rstrip("/"), token_values[0]

    base = os.environ.get("KS2_WORKBENCH_BASE", BASE_DEFAULT).strip().rstrip("/")
    token = os.environ.get("KS2_WORKBENCH_SESSION_TOKEN", "").strip()
    if not token:
        die("Set KS2_WORKBENCH_SESSION_URL or KS2_WORKBENCH_SESSION_TOKEN.")
    return base, token


def with_session(path_or_query: str, token: str) -> str:
    if "?" in path_or_query:
        path, query = path_or_query.split("?", 1)
        params = urllib.parse.parse_qsl(query, keep_blank_values=True)
    else:
        path, params = path_or_query, []
    params.append(("session", token))
    return path + "?" + urllib.parse.urlencode(params)


def request_json(base: str, token: str, method: str, endpoint: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    url = base + with_session(endpoint, token)
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw.strip() else None
        except json.JSONDecodeError:
            payload = raw[:1000]
        return exc.code, payload


def redact(obj: Any, token: str) -> Any:
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True)
    if token:
        text = text.replace(token, "<SESSION_TOKEN_REDACTED>")
    for marker in ["ghp_", "github_pat_", "gho_", "ghu_", "ghs_", "ghr_"]:
        text = text.replace(marker, "<GITHUB_TOKEN_PREFIX_REDACTED>_")
    return json.loads(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-smoke", action="store_true", help="Create agent branch, file, and PR. Leaves cleanup to operator.")
    args = parser.parse_args()

    base, token = parse_config()
    print(json.dumps({
        "probe_started_utc": dt.datetime.now(dt.UTC).isoformat(),
        "base": base,
        "session_token_present": bool(token),
        "mode": "write-smoke" if args.write_smoke else "read-only",
    }, indent=2))

    for endpoint in READ_ENDPOINTS:
        status, payload = request_json(base, token, "GET", endpoint)
        print(json.dumps({
            "endpoint": endpoint,
            "status": status,
            "payload": redact(payload, token),
        }, indent=2, ensure_ascii=False))
        if status >= 400:
            die(f"read probe failed at {endpoint} with HTTP {status}", 1)

    if not args.write_smoke:
        print("Read-only probe passed. Write smoke skipped.")
        return

    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%d-%H%M%S")
    branch = f"agent/rest-broker-smoke-{stamp}"
    path = f".agent-smoke/rest-broker-smoke-{stamp}.txt"
    content = f"REST broker smoke test from ChatGPT environment at {stamp} UTC\n"

    writes = [
        ("/api/github/branches", {"branch": branch}),
        ("/api/github/files", {"branch": branch, "path": path, "content": content, "message": "Add REST broker smoke file"}),
        ("/api/github/pulls", {
            "branch": branch,
            "title": f"REST broker smoke test {stamp}",
            "body": "Temporary smoke test proving the REST broker can create an agent branch, write one file, and open a PR. Cleanup is required by operator because the broker currently has no close/delete endpoint.",
            "draft": True,
        }),
    ]

    for endpoint, body in writes:
        status, payload = request_json(base, token, "POST", endpoint, body)
        print(json.dumps({
            "endpoint": endpoint,
            "status": status,
            "payload": redact(payload, token),
        }, indent=2, ensure_ascii=False))
        if status >= 400:
            die(f"write probe failed at {endpoint} with HTTP {status}", 1)

    print("Write smoke passed. Manual cleanup required: close PR and delete branch " + branch)


if __name__ == "__main__":
    main()
