import importlib.util
import json
import socket
import unittest
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse


PROBE_PATH = Path(__file__).resolve().parents[1] / "docs" / "ks2_workbench_broker_probe.py"


def load_probe():
    spec = importlib.util.spec_from_file_location("ks2_workbench_broker_probe", PROBE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode("utf-8")


class BrokerProbeTest(unittest.TestCase):
    def test_parse_session_url_redacts_query_token(self):
        probe = load_probe()

        config = probe.parse_session_url(
            "https://gptpro-gh-workbench.eugnel.uk/?session=super-secret-session&other=1"
        )

        self.assertEqual(config.base_url, "https://gptpro-gh-workbench.eugnel.uk")
        self.assertEqual(config.session_query, "session=super-secret-session")
        self.assertNotIn("super-secret-session", config.redacted_url)
        self.assertIn("session=<redacted>", config.redacted_url)

    def test_read_probe_reports_successful_authenticated_broker(self):
        probe = load_probe()
        config = probe.parse_session_url("https://gptpro-gh-workbench.eugnel.uk/?session=test-session")
        seen_paths = []

        def transport(request, timeout):
            parsed = urlparse(request.full_url)
            seen_paths.append(parsed.path)
            self.assertEqual(parse_qs(parsed.query)["session"], ["test-session"])
            self.assertEqual(request.get_header("User-agent"), "gptpro-gh-workbench-probe")
            payloads = {
                "/api/status": {
                    "capability_mode": "session-protected github write broker",
                    "target_repo": "fol2/ks2-mastery",
                },
                "/api/actions": {"actions": [{"id": "github.write", "status": "enabled"}]},
                "/api/github/repo": {"full_name": "fol2/ks2-mastery", "default_branch": "main"},
                "/api/github/auth": {"authenticated": True},
            }
            return FakeResponse(200, payloads[parsed.path])

        result = probe.run_read_probe(config, transport=transport)

        self.assertTrue(result["ok"])
        self.assertEqual(result["classification"], "broker_read_ready")
        self.assertEqual(
            seen_paths,
            ["/api/status", "/api/actions", "/api/github/repo", "/api/github/auth"],
        )
        self.assertNotIn("test-session", json.dumps(result))

    def test_dns_failure_is_reported_as_client_path_blocker(self):
        probe = load_probe()
        config = probe.parse_session_url("https://gptpro-gh-workbench.eugnel.uk/?session=test-session")

        def transport(request, timeout):
            raise URLError(socket.gaierror("could not resolve host"))

        result = probe.run_read_probe(config, transport=transport)

        self.assertFalse(result["ok"])
        self.assertEqual(result["classification"], "dns_failure")
        self.assertIn("client path", result["message"])
        self.assertNotIn("test-session", json.dumps(result))

    def test_unauthorised_session_is_reported_without_leaking_url(self):
        probe = load_probe()
        config = probe.parse_session_url("https://gptpro-gh-workbench.eugnel.uk/?session=expired-session")

        def transport(request, timeout):
            return FakeResponse(401, {"error": "unauthorised", "message": "A valid workbench session is required."})

        result = probe.run_read_probe(config, transport=transport)

        self.assertFalse(result["ok"])
        self.assertEqual(result["classification"], "unauthorised_session")
        self.assertNotIn("expired-session", json.dumps(result))

    def test_forbidden_edge_response_is_reported_without_leaking_url(self):
        probe = load_probe()
        config = probe.parse_session_url("https://gptpro-gh-workbench.eugnel.uk/?session=expired-session")

        def transport(request, timeout):
            return FakeResponse(403, {"error": "forbidden"})

        result = probe.run_read_probe(config, transport=transport)

        self.assertFalse(result["ok"])
        self.assertEqual(result["classification"], "forbidden_session_or_edge")
        self.assertNotIn("expired-session", json.dumps(result))

    def test_write_smoke_creates_pr_and_cleans_up(self):
        probe = load_probe()
        config = probe.parse_session_url("https://gptpro-gh-workbench.eugnel.uk/?session=write-session")
        seen_paths = []

        def transport(request, timeout):
            parsed = urlparse(request.full_url)
            seen_paths.append(parsed.path)
            body = json.loads(request.data.decode("utf-8"))
            if parsed.path == "/api/github/branches":
                self.assertEqual(body["branch"], "agent/workbench-smoke-test")
                return FakeResponse(200, {"ref": "refs/heads/agent/workbench-smoke-test"})
            if parsed.path == "/api/github/files":
                self.assertEqual(body["path"], ".agent-smoke/workbench-smoke-test.txt")
                return FakeResponse(200, {"content": {"path": body["path"]}})
            if parsed.path == "/api/github/pulls":
                return FakeResponse(200, {"number": 491, "html_url": "https://github.com/fol2/ks2-mastery/pull/491"})
            if parsed.path == "/api/github/pulls/close":
                self.assertEqual(body["number"], 491)
                return FakeResponse(200, {"number": 491, "state": "closed"})
            if parsed.path == "/api/github/branches/delete":
                self.assertEqual(body["branch"], "agent/workbench-smoke-test")
                return FakeResponse(200, {"deleted": True, "branch": body["branch"]})
            raise AssertionError(f"unexpected path: {parsed.path}")

        result = probe.run_write_smoke(
            config,
            branch_name="agent/workbench-smoke-test",
            transport=transport,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["classification"], "write_smoke_cleaned_up")
        self.assertEqual(result["pull_request"]["number"], 491)
        self.assertEqual(result["cleanup"], {"pr_closed": True, "branch_deleted": True, "manual_cleanup": []})
        self.assertEqual(
            seen_paths,
            [
                "/api/github/branches",
                "/api/github/files",
                "/api/github/pulls",
                "/api/github/pulls/close",
                "/api/github/branches/delete",
            ],
        )
        self.assertNotIn("write-session", json.dumps(result))

    def test_write_smoke_attempts_branch_cleanup_after_file_failure(self):
        probe = load_probe()
        config = probe.parse_session_url("https://gptpro-gh-workbench.eugnel.uk/?session=write-session")
        seen_paths = []

        def transport(request, timeout):
            parsed = urlparse(request.full_url)
            seen_paths.append(parsed.path)
            if parsed.path == "/api/github/branches":
                return FakeResponse(200, {"ref": "refs/heads/agent/workbench-smoke-test"})
            if parsed.path == "/api/github/files":
                return FakeResponse(502, {"error": "github_request_failed"})
            if parsed.path == "/api/github/branches/delete":
                return FakeResponse(200, {"deleted": True, "branch": "agent/workbench-smoke-test"})
            raise AssertionError(f"unexpected path: {parsed.path}")

        result = probe.run_write_smoke(
            config,
            branch_name="agent/workbench-smoke-test",
            transport=transport,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["classification"], "write_smoke_failed_cleanup_attempted")
        self.assertEqual(result["cleanup"], {"pr_closed": None, "branch_deleted": True, "manual_cleanup": []})
        self.assertEqual(seen_paths, ["/api/github/branches", "/api/github/files", "/api/github/branches/delete"])
        self.assertNotIn("write-session", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
