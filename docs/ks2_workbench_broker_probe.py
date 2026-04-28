#!/usr/bin/env python3
"""Probe the KS2 GitHub workbench broker with a signed session URL."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import re
import socket
import ssl
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlparse
from urllib.request import Request, urlopen


SESSION_URL_ENV = "KS2_WORKBENCH_SESSION_URL"
DEFAULT_SESSION_URL_FILE = Path.home() / ".config/gptpro-gh-workbench/session-url.txt"
READ_ENDPOINTS = (
    "/api/status",
    "/api/actions",
    "/api/github/repo",
    "/api/github/auth",
)


class ProbeConfigError(RuntimeError):
    pass


class ProbeConfig:
    def __init__(self, *, base_url: str, session_query: str, redacted_url: str):
        self.base_url = base_url
        self.session_query = session_query
        self.redacted_url = redacted_url


def redact_text(value: object) -> str:
    text = str(value)
    replacements = (
        (r"session=[^&#\s]+", "session=<redacted>"),
        (r"gptpro_workbench_session=[^;\s]+", "gptpro_workbench_session=<redacted>"),
        (r"github_pat_[A-Za-z0-9_]+", "github_pat_<redacted>"),
        (r"ghp_[A-Za-z0-9_]+", "ghp_<redacted>"),
        (r"Bearer\s+[A-Za-z0-9._~+/=-]{12,}", "Bearer <redacted>"),
    )
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text)
    return text


def parse_session_url(raw_url: str) -> ProbeConfig:
    candidate = raw_url.strip()
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ProbeConfigError("Session URL must be an absolute HTTP(S) URL.")

    session_values = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key == "session" and value
    ]
    session_query = urlencode(session_values[:1])

    return ProbeConfig(
        base_url=f"{parsed.scheme}://{parsed.netloc}",
        session_query=session_query,
        redacted_url=redact_text(candidate),
    )


def resolve_session_url(args: argparse.Namespace, environ: dict[str, str] | None = None) -> str:
    env = environ if environ is not None else os.environ
    if args.session_url:
        return args.session_url

    if env.get(SESSION_URL_ENV):
        return env[SESSION_URL_ENV]

    session_url_file = Path(args.session_url_file).expanduser()
    if session_url_file.exists():
        return session_url_file.read_text(encoding="utf-8").strip()

    raise ProbeConfigError(
        f"Missing signed workbench session URL. Set {SESSION_URL_ENV} or pass --session-url."
    )


def build_url(config: ProbeConfig, path: str) -> str:
    url = f"{config.base_url.rstrip('/')}{path}"
    if config.session_query:
        return f"{url}?{config.session_query}"
    return url


def request_json(
    config: ProbeConfig,
    method: str,
    path: str,
    *,
    body: dict[str, object] | None = None,
    timeout: float = 15,
    transport=urlopen,
) -> dict[str, object]:
    request_body = None
    headers = {"Accept": "application/json"}
    if body is not None:
        request_body = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(
        build_url(config, path),
        data=request_body,
        method=method,
        headers=headers,
    )

    try:
        response = transport(request, timeout=timeout)
        status = int(response.status if hasattr(response, "status") else response.getcode())
        return classify_response(path, status, response.read())
    except HTTPError as error:
        return classify_response(path, error.code, error.read())
    except URLError as error:
        return classify_url_error(path, error)
    except (TimeoutError, OSError, ssl.SSLError) as error:
        return {
            "ok": False,
            "endpoint": path,
            "status": None,
            "classification": "connection_failure",
            "message": redact_text(error),
        }


def classify_response(path: str, status: int, raw_body: bytes) -> dict[str, object]:
    payload, parse_error = parse_json_body(raw_body)

    if parse_error:
        return {
            "ok": False,
            "endpoint": path,
            "status": status,
            "classification": "non_json_response",
            "message": parse_error,
        }

    if 200 <= status < 300:
        return {
            "ok": True,
            "endpoint": path,
            "status": status,
            "classification": "ok",
            "payload": redact_payload(payload),
        }

    if status == 401:
        classification = "unauthorised_session"
        message = "The broker rejected the supplied workbench session."
    elif status == 403:
        classification = "forbidden_session_or_edge"
        message = "The broker or edge rejected the request before broker data was returned."
    elif isinstance(payload, dict) and payload.get("error") == "github_request_failed":
        classification = "github_upstream_failure"
        message = "The broker was reached, but GitHub returned an upstream failure."
    else:
        classification = "broker_http_failure"
        message = "The broker returned an HTTP failure."

    return {
        "ok": False,
        "endpoint": path,
        "status": status,
        "classification": classification,
        "message": message,
        "payload": redact_payload(payload),
    }


def parse_json_body(raw_body: bytes) -> tuple[object, str | None]:
    if not raw_body:
        return {}, None

    try:
        return json.loads(raw_body.decode("utf-8")), None
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "The broker returned a non-JSON response."


def classify_url_error(path: str, error: URLError) -> dict[str, object]:
    reason = error.reason
    if isinstance(reason, socket.gaierror) or "resolve" in str(reason).lower():
        return {
            "ok": False,
            "endpoint": path,
            "status": None,
            "classification": "dns_failure",
            "message": "DNS failure on the client path to the broker.",
        }

    if isinstance(reason, ssl.SSLError):
        classification = "tls_failure"
        message = "TLS failure on the client path to the broker."
    else:
        classification = "connection_failure"
        message = "Connection failure on the client path to the broker."

    return {
        "ok": False,
        "endpoint": path,
        "status": None,
        "classification": classification,
        "message": message,
        "detail": redact_text(reason),
    }


def redact_payload(payload: object) -> object:
    return json.loads(redact_text(json.dumps(payload)))


def run_read_probe(
    config: ProbeConfig,
    *,
    timeout: float = 15,
    transport=urlopen,
) -> dict[str, object]:
    checks = []
    payloads = {}

    for endpoint in READ_ENDPOINTS:
        check = request_json(config, "GET", endpoint, timeout=timeout, transport=transport)
        checks.append(summarise_check(check))
        if not check["ok"]:
            return {
                "ok": False,
                "classification": check["classification"],
                "message": f"{check['message']} This is a client path or broker readiness blocker.",
                "session_url": config.redacted_url,
                "checks": checks,
            }
        payloads[endpoint] = check.get("payload", {})

    status = payloads.get("/api/status", {})
    repo = payloads.get("/api/github/repo", {})
    actions = payloads.get("/api/actions", {})

    return {
        "ok": True,
        "classification": "broker_read_ready",
        "message": "Authenticated read probe completed.",
        "session_url": config.redacted_url,
        "target_repo": repo.get("full_name") or status.get("target_repo"),
        "capability_mode": status.get("capability_mode"),
        "actions": actions.get("actions", []),
        "checks": checks,
    }


def run_write_smoke(
    config: ProbeConfig,
    *,
    branch_name: str | None = None,
    timeout: float = 15,
    transport=urlopen,
) -> dict[str, object]:
    branch = branch_name or default_smoke_branch_name()
    smoke_path = smoke_file_path(branch)
    cleanup = {"pr_closed": None, "branch_deleted": None, "manual_cleanup": []}
    checks = []
    branch_created = False
    pull_request = None

    branch_result = post_json(
        config,
        "/api/github/branches",
        {"branch": branch},
        timeout=timeout,
        transport=transport,
    )
    checks.append(summarise_check(branch_result))
    if not branch_result["ok"]:
        return write_smoke_failure(config, branch, smoke_path, pull_request, cleanup, checks)
    branch_created = True

    file_result = post_json(
        config,
        "/api/github/files",
        {
            "branch": branch,
            "path": smoke_path,
            "content": "workbench smoke\n",
            "message": "Add workbench smoke file",
        },
        timeout=timeout,
        transport=transport,
    )
    checks.append(summarise_check(file_result))
    if not file_result["ok"]:
        cleanup = cleanup_smoke(config, branch, pull_request, branch_created, cleanup, checks, timeout, transport)
        return write_smoke_failure(config, branch, smoke_path, pull_request, cleanup, checks)

    pr_result = post_json(
        config,
        "/api/github/pulls",
        {
            "branch": branch,
            "title": "Workbench broker smoke",
            "body": "Temporary broker write smoke. The probe will close this PR and delete the branch.",
        },
        timeout=timeout,
        transport=transport,
    )
    checks.append(summarise_check(pr_result))
    if not pr_result["ok"]:
        cleanup = cleanup_smoke(config, branch, pull_request, branch_created, cleanup, checks, timeout, transport)
        return write_smoke_failure(config, branch, smoke_path, pull_request, cleanup, checks)

    pr_payload = pr_result.get("payload", {})
    if not isinstance(pr_payload, dict) or not isinstance(pr_payload.get("number"), int):
        cleanup = cleanup_smoke(config, branch, pull_request, branch_created, cleanup, checks, timeout, transport)
        return write_smoke_failure(config, branch, smoke_path, pull_request, cleanup, checks)

    pull_request = {
        "number": pr_payload["number"],
        "url": pr_payload.get("html_url"),
    }
    cleanup = cleanup_smoke(config, branch, pull_request, branch_created, cleanup, checks, timeout, transport)

    if cleanup["manual_cleanup"]:
        return {
            "ok": False,
            "classification": "write_smoke_cleanup_partial",
            "message": "Write smoke created broker artefacts, but cleanup was partial.",
            "session_url": config.redacted_url,
            "branch": branch,
            "path": smoke_path,
            "pull_request": pull_request,
            "cleanup": cleanup,
            "checks": checks,
        }

    return {
        "ok": True,
        "classification": "write_smoke_cleaned_up",
        "message": "Write smoke created and cleaned up the temporary PR and branch.",
        "session_url": config.redacted_url,
        "branch": branch,
        "path": smoke_path,
        "pull_request": pull_request,
        "cleanup": cleanup,
        "checks": checks,
    }


def post_json(
    config: ProbeConfig,
    path: str,
    body: dict[str, object],
    *,
    timeout: float,
    transport,
) -> dict[str, object]:
    return request_json(config, "POST", path, body=body, timeout=timeout, transport=transport)


def cleanup_smoke(
    config: ProbeConfig,
    branch: str,
    pull_request: dict[str, object] | None,
    branch_created: bool,
    cleanup: dict[str, object],
    checks: list[dict[str, object]],
    timeout: float,
    transport,
) -> dict[str, object]:
    if pull_request and isinstance(pull_request.get("number"), int):
        close_result = post_json(
            config,
            "/api/github/pulls/close",
            {"number": pull_request["number"]},
            timeout=timeout,
            transport=transport,
        )
        checks.append(summarise_check(close_result))
        cleanup["pr_closed"] = bool(close_result["ok"])
        if not close_result["ok"]:
            cleanup["manual_cleanup"].append(f"close PR #{pull_request['number']}")

    if branch_created:
        delete_result = post_json(
            config,
            "/api/github/branches/delete",
            {"branch": branch},
            timeout=timeout,
            transport=transport,
        )
        checks.append(summarise_check(delete_result))
        cleanup["branch_deleted"] = bool(delete_result["ok"])
        if not delete_result["ok"]:
            cleanup["manual_cleanup"].append(f"delete branch {branch}")

    return cleanup


def write_smoke_failure(
    config: ProbeConfig,
    branch: str,
    smoke_path: str,
    pull_request: dict[str, object] | None,
    cleanup: dict[str, object],
    checks: list[dict[str, object]],
) -> dict[str, object]:
    cleanup_attempted = cleanup["pr_closed"] is not None or cleanup["branch_deleted"] is not None
    return {
        "ok": False,
        "classification": "write_smoke_failed_cleanup_attempted" if cleanup_attempted else "write_smoke_failed",
        "message": "Write smoke failed before completion.",
        "session_url": config.redacted_url,
        "branch": branch,
        "path": smoke_path,
        "pull_request": pull_request,
        "cleanup": cleanup,
        "checks": checks,
    }


def default_smoke_branch_name() -> str:
    suffix = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return f"agent/workbench-smoke-{suffix}"


def smoke_file_path(branch: str) -> str:
    slug = branch.removeprefix("agent/").replace("/", "-")
    return f".agent-smoke/{slug}.txt"


def summarise_check(check: dict[str, object]) -> dict[str, object]:
    return {
        "endpoint": check["endpoint"],
        "status": check["status"],
        "classification": check["classification"],
        "ok": check["ok"],
    }


def print_text_result(result: dict[str, object]) -> None:
    print(f"classification: {result['classification']}")
    print(f"ok: {str(result['ok']).lower()}")
    print(f"message: {result['message']}")
    if result.get("target_repo"):
        print(f"target_repo: {result['target_repo']}")
    if result.get("capability_mode"):
        print(f"capability_mode: {result['capability_mode']}")
    print("checks:")
    for check in result.get("checks", []):
        print(
            f"- {check['endpoint']}: {check['classification']}"
            f" ({check['status'] if check['status'] is not None else 'no status'})"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Probe the session-protected KS2 GitHub workbench broker."
    )
    parser.add_argument("--session-url", help="Signed workbench session URL. Prefer the environment variable.")
    parser.add_argument(
        "--session-url-file",
        default=str(DEFAULT_SESSION_URL_FILE),
        help="File containing a signed workbench session URL.",
    )
    parser.add_argument("--timeout", type=float, default=15, help="HTTP timeout in seconds.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--write-smoke", action="store_true", help="Run an opt-in branch/file/PR write smoke.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        config = parse_session_url(resolve_session_url(args))
    except ProbeConfigError as error:
        result = {
            "ok": False,
            "classification": "missing_session_url",
            "message": str(error),
            "checks": [],
        }
    else:
        result = run_read_probe(config, timeout=args.timeout)
        if result["ok"] and args.write_smoke:
            read_probe = {
                "classification": result["classification"],
                "checks": result["checks"],
            }
            result = run_write_smoke(config, timeout=args.timeout)
            result["read_probe"] = read_probe

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print_text_result(result)

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
