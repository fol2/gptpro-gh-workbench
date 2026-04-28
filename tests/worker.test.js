import assert from "node:assert/strict";
import test from "node:test";

import { buildStatus, handleRequest, parseLimit } from "../src/worker.js";

const ORIGIN = "https://gptpro-gh-workbench.example";

test("status payload declares read-only foundation boundaries", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status`));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.service, "GPTPro GitHub Workbench Portal");
  assert.equal(payload.project_repo, "fol2/gptpro-gh-workbench");
  assert.equal(payload.target_repo, "fol2/ks2-mastery");
  assert.equal(payload.capability_mode, "read-only foundation");
  assert.equal(payload.executor_status.connected, false);
  assert.equal(payload.auth_write_status.enabled, false);
  assert.deepEqual(payload.allowlisted_read_endpoints, buildStatus().allowlisted_read_endpoints);
});

test("dashboard is browser-readable and states executor is disconnected", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/`));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /read-only/i);
  assert.match(html, /private executor is not connected yet/i);
  assert.match(html, /\/api\/status/);
  assert.match(html, /fol2\/ks2-mastery/);
});

test("actions endpoint marks writes and executor actions disabled", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/actions`));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "read-only foundation");

  const writeAction = payload.actions.find((action) => action.id === "github.write");
  const executorAction = payload.actions.find((action) => action.id === "executor.command");

  assert.equal(writeAction.status, "disabled");
  assert.equal(executorAction.status, "disabled");
});

test("unknown API paths return JSON 404", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/not-real`));
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(payload.error, "not_found");
});

test("unknown browser paths return HTML 404", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/missing`));
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
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/prs?limit=200`));
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
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/issues?limit=2`));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, [{ number: 4, title: "Issue" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safe API endpoints send read-only CORS without credentials", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status`));

  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
});

test("limit parsing defaults and caps conservative values", () => {
  assert.equal(parseLimit(null), 5);
  assert.equal(parseLimit("0"), 5);
  assert.equal(parseLimit("abc"), 5);
  assert.equal(parseLimit("3"), 3);
  assert.equal(parseLimit("200"), 10);
});
