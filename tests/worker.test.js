import assert from "node:assert/strict";
import test from "node:test";

import { buildStatus, handleRequest, parseLimit } from "../src/worker.js";

const ORIGIN = "https://gptpro-gh-workbench.example";
const TEST_ENV = { WORKBENCH_SESSION_TOKEN: "test-session" };
const SESSION = "?session=test-session";

test("status payload declares read-only foundation boundaries", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status${SESSION}`), TEST_ENV);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.service, "GPTPro GitHub Workbench Portal");
  assert.equal(payload.project_repo, "fol2/gptpro-gh-workbench");
  assert.equal(payload.target_repo, "fol2/ks2-mastery");
  assert.equal(payload.capability_mode, "read-only foundation");
  assert.equal(payload.portal_status, "responding/read-only foundation");
  assert.equal(payload.deployment_status, "not claimed until deployed and live-smoked");
  assert.equal(payload.access_status, "session required");
  assert.equal(payload.executor_status.connected, false);
  assert.equal(payload.auth_write_status.enabled, false);
  assert.deepEqual(payload.allowlisted_read_endpoints, buildStatus().allowlisted_read_endpoints);
});

test("dashboard is browser-readable and states executor is disconnected", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/${SESSION}`), TEST_ENV);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /read-only/i);
  assert.match(html, /private executor is not connected yet/i);
  assert.match(html, /not claimed until deployed and live-smoked/i);
  assert.match(html, /href="\/api\/status\?session=test-session"/);
  assert.match(html, /href="\/api\/github\/prs\?limit=5&amp;session=test-session"/);
  assert.match(html, /fol2\/ks2-mastery/);
  assert.match(response.headers.get("set-cookie") ?? "", /gptpro_workbench_session=test-session/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Strict/);
  assert.match(response.headers.get("set-cookie") ?? "", /Secure/);
});

test("actions endpoint marks writes and executor actions disabled", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/actions${SESSION}`), TEST_ENV);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "read-only foundation");

  const writeAction = payload.actions.find((action) => action.id === "github.write");
  const executorAction = payload.actions.find((action) => action.id === "executor.command");

  assert.equal(writeAction.status, "disabled");
  assert.equal(executorAction.status, "disabled");
});

test("unknown API paths return JSON 404", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/not-real${SESSION}`), TEST_ENV);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(payload.error, "not_found");
});

test("unknown browser paths return HTML 404", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/missing${SESSION}`), TEST_ENV);
  const html = await response.text();

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /This browser path is not part of the portal foundation/);
});

test("GitHub PR route uses fixed repository API base and capped limit", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json([{ number: 12, title: "Open PR" }]);
  };

  try {
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/prs?limit=200&session=test-session`), TEST_ENV);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.github.com/repos/fol2/ks2-mastery/pulls?state=open&per_page=10");
    assert.equal(calls[0].init.headers["User-Agent"], "gptpro-gh-workbench-readonly-portal");
    assert.deepEqual(payload, [{ number: 12, title: "Open PR" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub issues route excludes pull requests where practical", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => Response.json([
    { number: 4, title: "Issue" },
    { number: 5, title: "PR", pull_request: { url: "https://api.github.com/pulls/5" } }
  ]);

  try {
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/issues?limit=2&session=test-session`), TEST_ENV);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, [{ number: 4, title: "Issue" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safe API endpoints send read-only CORS without credentials", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status${SESSION}`), TEST_ENV);

  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
});

test("dashboard and API require a valid workbench session", async () => {
  const pageResponse = await handleRequest(new Request(`${ORIGIN}/`), TEST_ENV);
  const apiResponse = await handleRequest(new Request(`${ORIGIN}/api/status`), TEST_ENV);
  const apiPayload = await apiResponse.json();

  assert.equal(pageResponse.status, 401);
  assert.match(await pageResponse.text(), /Session required/);
  assert.equal(apiResponse.status, 401);
  assert.equal(apiPayload.error, "unauthorised");
});

test("cookie session is accepted without query token", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status`, {
    headers: {
      Cookie: "gptpro_workbench_session=test-session"
    }
  }), TEST_ENV);

  assert.equal(response.status, 200);
});

test("cookie dashboard access does not echo the session token into links", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/`, {
    headers: {
      Cookie: "gptpro_workbench_session=test-session"
    }
  }), TEST_ENV);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /href="\/api\/status"/);
  assert.doesNotMatch(html, /session=test-session/);
});

test("deployment status can be supplied from environment", () => {
  const payload = buildStatus({
    WORKBENCH_DEPLOYMENT_STATUS: "deployed/live-smoked on 2026-04-28"
  });

  assert.equal(payload.deployment_status, "deployed/live-smoked on 2026-04-28");
});

test("GitHub upstream failures propagate as non-200 responses", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => Response.json({ message: "rate limit" }, { status: 403 });

  try {
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/repo${SESSION}`), TEST_ENV);
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.error, "github_request_failed");
    assert.equal(payload.upstream_status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("limit parsing defaults and caps conservative values", () => {
  assert.equal(parseLimit(null), 5);
  assert.equal(parseLimit("0"), 5);
  assert.equal(parseLimit("abc"), 5);
  assert.equal(parseLimit("3"), 3);
  assert.equal(parseLimit("200"), 10);
});
