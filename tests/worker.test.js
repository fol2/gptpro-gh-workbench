import assert from "node:assert/strict";
import test from "node:test";

import { buildStatus, handleRequest, parseLimit } from "../src/worker.js";

const ORIGIN = "https://gptpro-gh-workbench.example";
const TEST_ENV = { WORKBENCH_SESSION_TOKEN: "test-session" };
const WRITE_ENV = {
  WORKBENCH_SESSION_TOKEN: "test-session",
  GH_TOKEN: "github_pat_testsecret"
};
const SESSION = "?session=test-session";

function createFakeActionStore() {
  const entries = new Map();

  return {
    entries,
    async get(key, type) {
      const value = entries.get(key) ?? null;
      return type === "json" && value ? JSON.parse(value) : value;
    },
    async put(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    }
  };
}

function actionEnv(overrides = {}) {
  return {
    ...WRITE_ENV,
    WORKBENCH_ACTION_KV: createFakeActionStore(),
    ...overrides
  };
}

function jsonPost(path, body, env = WRITE_ENV) {
  return handleRequest(new Request(`${ORIGIN}${path}${SESSION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }), env);
}

function jsonPostWithoutWorkbenchSession(path, body, env = WRITE_ENV) {
  return handleRequest(new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }), env);
}

async function createPasscode(env, body = {}) {
  const response = await jsonPost("/api/action/passcodes", body, env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(payload.passcode, /^WB-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  return payload;
}

async function exchangePasscode(env, passcode, body = {}) {
  const response = await jsonPostWithoutWorkbenchSession("/api/action/exchange", { passcode, ...body }, env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(payload.actionSession, /^as_[0-9a-f]{64}$/);
  return payload;
}

async function withMockedFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init, calls);
  };

  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("status payload declares broker boundaries without GH_TOKEN", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status${SESSION}`), TEST_ENV);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.service, "GPTPro GitHub Workbench Portal");
  assert.equal(payload.project_repo, "fol2/gptpro-gh-workbench");
  assert.equal(payload.target_repo, "fol2/ks2-mastery");
  assert.deepEqual(payload.allowed_target_repos, ["fol2/ks2-mastery", "fol2/gptpro-gh-workbench"]);
  assert.equal(payload.capability_mode, "read-only without GH_TOKEN");
  assert.equal(payload.portal_status, "responding/read-only without GH_TOKEN");
  assert.equal(payload.deployment_status, "not claimed until deployed and live-smoked");
  assert.equal(payload.access_status, "session required");
  assert.equal(payload.executor_status.connected, false);
  assert.equal(payload.auth_write_status.enabled, false);
  assert.deepEqual(payload.allowlisted_read_endpoints, buildStatus().allowlisted_read_endpoints);
  assert.match(payload.allowlisted_read_endpoints.join(" "), /\/api\/action\/readiness/);
  assert.match(payload.allowlisted_write_endpoints.join(" "), /POST \/api\/github\/pulls/);
  assert.match(payload.allowlisted_write_endpoints.join(" "), /POST \/api\/github\/pulls\/merge/);
});

test("status reports write broker mode when GH_TOKEN is configured", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status${SESSION}`), WRITE_ENV);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.capability_mode, "session-protected github write broker");
  assert.equal(payload.auth_write_status.enabled, true);
  assert.doesNotMatch(JSON.stringify(payload), /github_pat_testsecret/);
});

test("dashboard is browser-readable and states narrow broker scope", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/${SESSION}`), WRITE_ENV);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /narrow write endpoints for agent branches, including guarded agent PR merges/i);
  assert.match(html, /not claimed until deployed and live-smoked/i);
  assert.match(html, /href="\/api\/status\?session=test-session"/);
  assert.match(html, /href="\/api\/github\/auth\?session=test-session"/);
  assert.match(html, /href="\/api\/github\/prs\?limit=5&amp;session=test-session"/);
  assert.match(html, /fol2\/ks2-mastery/);
  assert.doesNotMatch(html, /github_pat_testsecret/);
  assert.match(response.headers.get("set-cookie") ?? "", /gptpro_workbench_session=test-session/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Strict/);
  assert.match(response.headers.get("set-cookie") ?? "", /Secure/);
});

test("actions endpoint reflects GH_TOKEN-backed write capability without exposing the token", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/actions${SESSION}`), WRITE_ENV);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "github write broker");

  const writeAction = payload.actions.find((action) => action.id === "github.write");
  const executorAction = payload.actions.find((action) => action.id === "executor.command");
  const readinessAction = payload.actions.find((action) => action.id === "workbench.action.readiness");

  assert.equal(readinessAction.status, "enabled");
  assert.equal(readinessAction.endpoint, "/api/action/readiness");
  assert.equal(writeAction.status, "enabled");
  assert.equal(executorAction.status, "disabled");
  assert.doesNotMatch(JSON.stringify(payload), /github_pat_testsecret/);
});

test("actions endpoint reports action passcode support only when KV is configured", async () => {
  const noStore = await handleRequest(new Request(`${ORIGIN}/api/actions${SESSION}`), WRITE_ENV);
  const noStorePayload = await noStore.json();
  const withStore = await handleRequest(new Request(`${ORIGIN}/api/actions${SESSION}`), actionEnv());
  const withStorePayload = await withStore.json();

  assert.equal(noStorePayload.actions.find((action) => action.id === "workbench.action.passcode.create").status, "disabled");
  assert.equal(noStorePayload.actions.find((action) => action.id === "workbench.action.exchange").status, "disabled");
  assert.equal(withStorePayload.actions.find((action) => action.id === "workbench.action.passcode.create").status, "enabled");
  assert.equal(withStorePayload.actions.find((action) => action.id === "workbench.action.exchange").status, "enabled");
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
  await withMockedFetch(
    () => Response.json([{ number: 12, title: "Open PR" }]),
    async (calls) => {
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/prs?limit=200&session=test-session`), WRITE_ENV);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.github.com/repos/fol2/ks2-mastery/pulls?state=open&per_page=10");
    assert.equal(calls[0].init.headers["User-Agent"], "gptpro-gh-workbench-broker");
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.deepEqual(payload, [{ number: 12, title: "Open PR" }]);
    }
  );
});

test("GitHub read routes can target the allowlisted workbench repository", async () => {
  await withMockedFetch(
    () => Response.json({ full_name: "fol2/gptpro-gh-workbench", default_branch: "main" }),
    async (calls) => {
    const response = await handleRequest(
      new Request(`${ORIGIN}/api/github/repo?repo=fol2%2Fgptpro-gh-workbench${SESSION.replace("?", "&")}`),
      WRITE_ENV
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.github.com/repos/fol2/gptpro-gh-workbench");
    assert.equal(payload.full_name, "fol2/gptpro-gh-workbench");
    }
  );
});

test("GitHub issues route excludes pull requests where practical", async () => {
  await withMockedFetch(() => Response.json([
    { number: 4, title: "Issue" },
    { number: 5, title: "PR", pull_request: { url: "https://api.github.com/pulls/5" } }
  ]), async () => {
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/issues?limit=2&session=test-session`), TEST_ENV);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, [{ number: 4, title: "Issue" }]);
  });
});

test("safe API endpoints send CORS without credentials", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status${SESSION}`), TEST_ENV);

  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /X-Workbench-Session/);
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

test("workbench session header authenticates API requests without query tokens", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/status`, {
    headers: {
      "X-Workbench-Session": "test-session"
    }
  }), TEST_ENV);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.target_repo, "fol2/ks2-mastery");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("safe API preflight allows the workbench session header", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/action/readiness`, {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Headers": "X-Workbench-Session"
    }
  }), TEST_ENV);

  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /X-Workbench-Session/);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
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
  await withMockedFetch(() => Response.json({ message: "rate limit" }, { status: 403 }), async () => {
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/repo${SESSION}`), TEST_ENV);
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.error, "github_request_failed");
    assert.equal(payload.upstream_status, 403);
  });
});

test("GitHub auth endpoint reports token-backed identity and repository permission without token leakage", async () => {
  await withMockedFetch((url) => {
    if (url === "https://api.github.com/user") {
      return Response.json({ login: "fol2", id: 105634418 });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery");
    return Response.json({
      full_name: "fol2/ks2-mastery",
      default_branch: "main",
      permissions: { admin: true, push: true, pull: true }
    });
  }, async (calls) => {
    const response = await handleRequest(new Request(`${ORIGIN}/api/github/auth${SESSION}`), WRITE_ENV);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.github_user.login, "fol2");
    assert.equal(payload.repository.viewer_permission, "ADMIN");
    assert.equal(payload.capabilities.direct_main_write, false);
    assert.equal(payload.capabilities.merge_agent_pull_request, true);
    assert.equal(payload.capabilities.merge, "agent_pr_squash_only");
    assert.equal(calls[0].init.headers.Authorization, "Bearer github_pat_testsecret");
    assert.doesNotMatch(JSON.stringify(payload), /github_pat_testsecret/);
  });
});

test("action readiness returns broker_read_ready after read and auth checks", async () => {
  await withMockedFetch((url) => {
    if (url === "https://api.github.com/user") {
      return Response.json({ login: "fol2", id: 105634418 });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery");
    return Response.json({
      full_name: "fol2/ks2-mastery",
      default_branch: "main",
      permissions: { admin: true, push: true, pull: true }
    });
  }, async (calls) => {
    const response = await handleRequest(new Request(`${ORIGIN}/api/action/readiness`, {
      headers: {
        "X-Workbench-Session": "test-session"
      }
    }), WRITE_ENV);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.classification, "broker_read_ready");
    assert.equal(payload.target_repo, "fol2/ks2-mastery");
    assert.equal(payload.viewer, "fol2");
    assert.equal(payload.permission, "ADMIN");
    assert.equal(payload.auth_channel, "X-Workbench-Session");
    assert.equal(payload.runtime_install_required, false);
    assert.deepEqual(
      payload.checks.map((check) => [check.endpoint, check.classification]),
      [
        ["/api/status", "ok"],
        ["/api/actions", "ok"],
        ["/api/github/repo", "ok"],
        ["/api/github/auth", "ok"]
      ]
    );
    assert.equal(calls.length, 3);
    assert.doesNotMatch(JSON.stringify(payload), /github_pat_testsecret/);
    assert.doesNotMatch(JSON.stringify(payload), /test-session/);
  });
});

test("action readiness stops when GitHub auth is unavailable", async () => {
  await withMockedFetch((url, init) => {
    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery");
    assert.equal(init.headers.Authorization, undefined);
    return Response.json({
      full_name: "fol2/ks2-mastery",
      default_branch: "main"
    });
  }, async (calls) => {
    const response = await handleRequest(new Request(`${ORIGIN}/api/action/readiness${SESSION}`), TEST_ENV);
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.equal(payload.classification, "github_token_missing");
    assert.equal(payload.target_repo, "fol2/ks2-mastery");
    assert.equal(calls.length, 1);
  });
});

test("action readiness rejects read-only repository permissions", async () => {
  await withMockedFetch((url) => {
    if (url === "https://api.github.com/user") {
      return Response.json({ login: "fol2", id: 105634418 });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery");
    return Response.json({
      full_name: "fol2/ks2-mastery",
      default_branch: "main",
      permissions: { pull: true }
    });
  }, async () => {
    const response = await handleRequest(new Request(`${ORIGIN}/api/action/readiness${SESSION}`), WRITE_ENV);
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);
    assert.equal(payload.classification, "insufficient_repository_permission");
    assert.equal(payload.permission, "READ");
  });
});

test("action passcode creation requires normal session and configured KV", async () => {
  const noSession = await jsonPostWithoutWorkbenchSession("/api/action/passcodes", {}, actionEnv());
  const noSessionPayload = await noSession.json();
  const noStore = await jsonPost("/api/action/passcodes", {}, WRITE_ENV);
  const noStorePayload = await noStore.json();
  const inconsistentScope = await jsonPost("/api/action/passcodes", { write: false, merge: true }, actionEnv());
  const inconsistentScopePayload = await inconsistentScope.json();

  assert.equal(noSession.status, 401);
  assert.equal(noSessionPayload.error, "unauthorised");
  assert.equal(noStore.status, 503);
  assert.equal(noStorePayload.error, "action_store_missing");
  assert.equal(inconsistentScope.status, 400);
  assert.equal(inconsistentScopePayload.field, "merge");
});

test("workbench session can create a one-time action passcode without storing it raw", async () => {
  const env = actionEnv();
  const payload = await createPasscode(env, {
    repo: "fol2/gptpro-gh-workbench",
    ttlSeconds: 120,
    sessionTtlSeconds: 300,
    maxRequests: 2,
    write: true
  });

  assert.equal(payload.scope.repo, "fol2/gptpro-gh-workbench");
  assert.equal(payload.scope.read, true);
  assert.equal(payload.scope.write, true);
  assert.equal(payload.scope.merge, false);
  assert.equal(payload.scope.maxRequests, 2);
  assert.equal(payload.scope.sessionTtlSeconds, 300);
  assert.doesNotMatch(JSON.stringify(payload), /github_pat_testsecret/);
  assert.doesNotMatch(JSON.stringify(payload), /test-session/);

  for (const storedValue of env.WORKBENCH_ACTION_KV.entries.values()) {
    assert.doesNotMatch(storedValue, new RegExp(payload.passcode.replaceAll("-", "\\-")));
  }
});

test("action passcode defaults create 300-minute sessions with 500 requests", async () => {
  const env = actionEnv();
  const payload = await createPasscode(env);

  assert.equal(payload.scope.repo, "fol2/ks2-mastery");
  assert.equal(payload.scope.read, true);
  assert.equal(payload.scope.write, true);
  assert.equal(payload.scope.merge, false);
  assert.equal(payload.scope.maxRequests, 500);
  assert.equal(payload.scope.sessionTtlSeconds, 18000);
});

test("action passcode validation caps exchanged session size", async () => {
  const tooLong = await jsonPost("/api/action/passcodes", {
    sessionTtlSeconds: 18001
  }, actionEnv());
  const tooLongPayload = await tooLong.json();
  const tooMany = await jsonPost("/api/action/passcodes", {
    maxRequests: 501
  }, actionEnv());
  const tooManyPayload = await tooMany.json();

  assert.equal(tooLong.status, 400);
  assert.equal(tooLongPayload.field, "sessionTtlSeconds");
  assert.equal(tooMany.status, 400);
  assert.equal(tooManyPayload.field, "maxRequests");
});

test("action passcode exchange is one-time and returns a short-lived action session", async () => {
  const env = actionEnv();
  const passcodePayload = await createPasscode(env, { maxRequests: 3, write: true });
  const exchangePayload = await exchangePasscode(env, passcodePayload.passcode);
  const repeated = await jsonPostWithoutWorkbenchSession("/api/action/exchange", {
    passcode: passcodePayload.passcode
  }, env);
  const repeatedPayload = await repeated.json();

  assert.equal(exchangePayload.scope.repo, "fol2/ks2-mastery");
  assert.equal(exchangePayload.scope.read, true);
  assert.equal(exchangePayload.scope.write, true);
  assert.equal(exchangePayload.scope.merge, false);
  assert.equal(exchangePayload.scope.requestsRemaining, 3);
  assert.doesNotMatch(JSON.stringify(exchangePayload), new RegExp(passcodePayload.passcode.replaceAll("-", "\\-")));
  assert.equal(repeated.status, 401);
  assert.equal(repeatedPayload.error, "invalid_action_passcode");
});

test("action session can call readiness without header or query session", async () => {
  const env = actionEnv();
  const passcodePayload = await createPasscode(env, { maxRequests: 3 });
  const exchangePayload = await exchangePasscode(env, passcodePayload.passcode);

  await withMockedFetch((url) => {
    if (url === "https://api.github.com/user") {
      return Response.json({ login: "fol2", id: 105634418 });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery");
    return Response.json({
      full_name: "fol2/ks2-mastery",
      default_branch: "main",
      permissions: { admin: true, push: true, pull: true }
    });
  }, async (calls) => {
    const response = await jsonPostWithoutWorkbenchSession("/api/action/readiness", {
      actionSession: exchangePayload.actionSession
    }, env);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.classification, "broker_read_ready");
    assert.equal(payload.target_repo, "fol2/ks2-mastery");
    assert.equal(calls.length, 3);
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(exchangePayload.actionSession));
  });
});

test("action session can write through fixed GitHub endpoints without workbench session", async () => {
  const env = actionEnv();
  const passcodePayload = await createPasscode(env, { maxRequests: 3 });
  const exchangePayload = await exchangePasscode(env, passcodePayload.passcode);

  await withMockedFetch((url, init) => {
    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery/issues");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {
      title: "Action issue",
      body: "Created through actionSession"
    });
    return Response.json({ number: 22, html_url: "https://github.com/fol2/ks2-mastery/issues/22" }, { status: 201 });
  }, async (calls) => {
    const response = await jsonPostWithoutWorkbenchSession("/api/github/issues", {
      actionSession: exchangePayload.actionSession,
      title: "Action issue",
      body: "Created through actionSession"
    }, env);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.number, 22);
    assert.equal(calls.length, 1);
  });
});

test("action session rejects wrong repository and merge without merge scope before GitHub calls", async () => {
  const env = actionEnv();
  const passcodePayload = await createPasscode(env, { write: true, merge: false });
  const exchangePayload = await exchangePasscode(env, passcodePayload.passcode);

  await withMockedFetch(() => {
    throw new Error("GitHub should not be called for invalid action session scope");
  }, async () => {
    const wrongRepo = await jsonPostWithoutWorkbenchSession("/api/github/issues", {
      actionSession: exchangePayload.actionSession,
      repo: "fol2/gptpro-gh-workbench",
      title: "Wrong repo"
    }, env);
    const wrongRepoPayload = await wrongRepo.json();
    const deniedMerge = await jsonPostWithoutWorkbenchSession("/api/github/pulls/merge", {
      actionSession: exchangePayload.actionSession,
      number: 494,
      expectedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }, env);
    const deniedMergePayload = await deniedMerge.json();

    assert.equal(wrongRepo.status, 400);
    assert.equal(wrongRepoPayload.field, "repo");
    assert.equal(deniedMerge.status, 403);
    assert.equal(deniedMergePayload.error, "action_session_scope_denied");
  });
});

test("write endpoints require session, GH_TOKEN, and JSON", async () => {
  const noSession = await handleRequest(new Request(`${ORIGIN}/api/github/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "No session" })
  }), WRITE_ENV);
  assert.equal(noSession.status, 401);

  const noToken = await jsonPost("/api/github/issues", { title: "No token" }, TEST_ENV);
  const noTokenPayload = await noToken.json();
  assert.equal(noToken.status, 503);
  assert.equal(noTokenPayload.error, "github_token_missing");

  const badContentType = await handleRequest(new Request(`${ORIGIN}/api/github/issues${SESSION}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "not json"
  }), WRITE_ENV);
  assert.equal(badContentType.status, 415);

  const wrongShape = await handleRequest(new Request(`${ORIGIN}/api/github/issues${SESSION}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null"
  }), WRITE_ENV);
  const wrongShapePayload = await wrongShape.json();

  assert.equal(wrongShape.status, 400);
  assert.equal(wrongShapePayload.error, "invalid_json_object");
});

test("write validation rejects unsafe branches and workflow paths", async () => {
  const mainBranch = await jsonPost("/api/github/branches", { branch: "main" });
  assert.equal(mainBranch.status, 400);

  const nonAgentBranch = await jsonPost("/api/github/pulls", { branch: "feature/x", title: "Nope" });
  assert.equal(nonAgentBranch.status, 400);

  const workflowWrite = await jsonPost("/api/github/files", {
    branch: "agent/safe-task",
    path: ".github/workflows/deploy.yml",
    content: "name: deploy"
  });
  const workflowPayload = await workflowWrite.json();

  assert.equal(workflowWrite.status, 400);
  assert.equal(workflowPayload.field, "path");
});

test("repository allowlist rejects unknown read and write targets before GitHub calls", async () => {
  await withMockedFetch(() => {
    throw new Error("GitHub should not be called for unknown repositories");
  }, async () => {
    const read = await handleRequest(
      new Request(`${ORIGIN}/api/github/repo?repo=fol2%2Fnot-allowed${SESSION.replace("?", "&")}`),
      WRITE_ENV
    );
    const readPayload = await read.json();
    const write = await jsonPost("/api/github/issues", {
      repo: "fol2/not-allowed",
      title: "Nope"
    });
    const writePayload = await write.json();
    const readiness = await handleRequest(
      new Request(`${ORIGIN}/api/action/readiness?repo=fol2%2Fnot-allowed&session=test-session`),
      WRITE_ENV
    );
    const readinessPayload = await readiness.json();

    assert.equal(read.status, 400);
    assert.equal(readPayload.field, "repo");
    assert.equal(write.status, 400);
    assert.equal(writePayload.field, "repo");
    assert.equal(readiness.status, 400);
    assert.equal(readinessPayload.field, "repo");
  });
});

test("issue and comment write endpoints call fixed GitHub repository APIs", async () => {
  await withMockedFetch((url, init) => {
    if (url.endsWith("/issues")) {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { title: "Workbench issue", body: "Created by broker" });
      return Response.json({ number: 10, html_url: "https://github.com/fol2/ks2-mastery/issues/10" }, { status: 201 });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery/issues/10/comments");
    assert.deepEqual(JSON.parse(init.body), { body: "Review note" });
    return Response.json({ id: 20, html_url: "https://github.com/fol2/ks2-mastery/issues/10#issuecomment-20" }, { status: 201 });
  }, async (calls) => {
    const issue = await jsonPost("/api/github/issues", { title: "Workbench issue", body: "Created by broker" });
    const issuePayload = await issue.json();
    const comment = await jsonPost("/api/github/comments", { number: 10, body: "Review note" });
    const commentPayload = await comment.json();

    assert.equal(issue.status, 200);
    assert.equal(issuePayload.number, 10);
    assert.equal(comment.status, 200);
    assert.equal(commentPayload.id, 20);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.headers.Authorization, "Bearer github_pat_testsecret");
  });
});

test("write endpoints can target the allowlisted workbench repository", async () => {
  await withMockedFetch((url, init) => {
    assert.equal(url, "https://api.github.com/repos/fol2/gptpro-gh-workbench/issues");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {
      title: "Workbench repo issue",
      body: "Created by broker"
    });
    return Response.json({ number: 15, html_url: "https://github.com/fol2/gptpro-gh-workbench/issues/15" }, { status: 201 });
  }, async (calls) => {
    const issue = await jsonPost("/api/github/issues", {
      repo: "fol2/gptpro-gh-workbench",
      title: "Workbench repo issue",
      body: "Created by broker"
    });
    const issuePayload = await issue.json();

    assert.equal(issue.status, 200);
    assert.equal(issuePayload.number, 15);
    assert.equal(calls.length, 1);
  });
});

test("branch, file, and PR write endpoints stay on agent branches", async () => {
  await withMockedFetch((url, init) => {
    if (url === "https://api.github.com/repos/fol2/ks2-mastery/git/ref/heads/main") {
      return Response.json({ object: { sha: "0123456789abcdef0123456789abcdef01234567" } });
    }

    if (url === "https://api.github.com/repos/fol2/ks2-mastery/git/refs") {
      assert.deepEqual(JSON.parse(init.body), {
        ref: "refs/heads/agent/workbench-smoke",
        sha: "0123456789abcdef0123456789abcdef01234567"
      });
      return Response.json({ ref: "refs/heads/agent/workbench-smoke" }, { status: 201 });
    }

    if (url === "https://api.github.com/repos/fol2/ks2-mastery/contents/.agent-smoke/workbench-smoke.txt?ref=agent%2Fworkbench-smoke") {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }

    if (url === "https://api.github.com/repos/fol2/ks2-mastery/contents/.agent-smoke/workbench-smoke.txt") {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, "agent/workbench-smoke");
      assert.equal(body.message, "Add smoke file");
      assert.equal(body.content, "ICB3b3JrYmVuY2ggc21va2UK");
      return Response.json({ content: { path: ".agent-smoke/workbench-smoke.txt" } }, { status: 201 });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery/pulls");
    assert.deepEqual(JSON.parse(init.body), {
      title: "Workbench smoke test",
      head: "agent/workbench-smoke",
      base: "main",
      body: "Temporary PR",
      draft: false
    });
    return Response.json({ number: 11, html_url: "https://github.com/fol2/ks2-mastery/pull/11" }, { status: 201 });
  }, async (calls) => {
    const branch = await jsonPost("/api/github/branches", { branch: "agent/workbench-smoke" });
    const file = await jsonPost("/api/github/files", {
      branch: "agent/workbench-smoke",
      path: ".agent-smoke/workbench-smoke.txt",
      content: "  workbench smoke\n",
      message: "Add smoke file"
    });
    const pr = await jsonPost("/api/github/pulls", {
      branch: "agent/workbench-smoke",
      title: "Workbench smoke test",
      body: "Temporary PR"
    });

    assert.equal(branch.status, 200);
    assert.equal(file.status, 200);
    assert.equal(pr.status, 200);
    assert.equal(calls.length, 5);
  });
});

test("cleanup endpoints close PRs and delete agent branches through fixed APIs", async () => {
  await withMockedFetch((url, init) => {
    if (url === "https://api.github.com/repos/fol2/ks2-mastery/pulls/491") {
      assert.equal(init.method, "PATCH");
      assert.deepEqual(JSON.parse(init.body), { state: "closed" });
      return Response.json({ number: 491, state: "closed", html_url: "https://github.com/fol2/ks2-mastery/pull/491" });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery/git/refs/heads/agent/workbench-smoke-20260428-1713");
    assert.equal(init.method, "DELETE");
    return new Response(null, { status: 204 });
  }, async (calls) => {
    const closePr = await jsonPost("/api/github/pulls/close", { number: 491 });
    const closePayload = await closePr.json();
    const deleteBranch = await jsonPost("/api/github/branches/delete", {
      branch: "agent/workbench-smoke-20260428-1713"
    });
    const deletePayload = await deleteBranch.json();

    assert.equal(closePr.status, 200);
    assert.equal(closePayload.state, "closed");
    assert.equal(deleteBranch.status, 200);
    assert.equal(deletePayload.deleted, true);
    assert.equal(deletePayload.branch, "agent/workbench-smoke-20260428-1713");
    assert.equal(calls.length, 2);
  });
});

test("cleanup validation rejects unsafe PR numbers and branches before GitHub calls", async () => {
  await withMockedFetch(() => {
    throw new Error("GitHub should not be called for invalid cleanup input");
  }, async () => {
    const badNumber = await jsonPost("/api/github/pulls/close", { number: 0 });
    const badNumberPayload = await badNumber.json();
    const nonIntegerNumber = await jsonPost("/api/github/pulls/close", { number: "491abc" });
    const mainBranch = await jsonPost("/api/github/branches/delete", { branch: "main" });
    const nonAgentBranch = await jsonPost("/api/github/branches/delete", { branch: "feature/workbench-smoke" });
    const refsBranch = await jsonPost("/api/github/branches/delete", { branch: "refs/heads/agent/workbench-smoke" });

    assert.equal(badNumber.status, 400);
    assert.equal(badNumberPayload.field, "number");
    assert.equal(nonIntegerNumber.status, 400);
    assert.equal(mainBranch.status, 400);
    assert.equal(nonAgentBranch.status, 400);
    assert.equal(refsBranch.status, 400);
  });
});

test("merge endpoint verifies an agent PR before calling GitHub's merge API", async () => {
  await withMockedFetch((url, init, calls) => {
    if (url === "https://api.github.com/repos/fol2/ks2-mastery/pulls/494" && calls.length === 1) {
      assert.equal(init.method, "GET");
      return Response.json({
        number: 494,
        state: "open",
        draft: false,
        html_url: "https://github.com/fol2/ks2-mastery/pull/494",
        mergeable: true,
        head: {
          ref: "agent/merge-ready",
          sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          repo: { full_name: "fol2/ks2-mastery" }
        },
        base: {
          ref: "main",
          repo: { full_name: "fol2/ks2-mastery" }
        }
      });
    }

    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery/pulls/494/merge");
    assert.equal(init.method, "PUT");
    assert.deepEqual(JSON.parse(init.body), {
      merge_method: "squash",
      commit_title: "Merge broker smoke",
      commit_message: "Merged by guarded broker.",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    return Response.json({
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      merged: true,
      message: "Pull Request successfully merged"
    });
  }, async (calls) => {
    const response = await jsonPost("/api/github/pulls/merge", {
      number: 494,
      title: "Merge broker smoke",
      message: "Merged by guarded broker.",
      expectedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.merged, true);
    assert.equal(payload.number, 494);
    assert.equal(payload.method, "squash");
    assert.equal(payload.sha, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert.deepEqual(payload.head, {
      ref: "agent/merge-ready",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    assert.equal(calls.length, 2);
  });
});

test("merge validation rejects unsupported methods before GitHub calls", async () => {
  await withMockedFetch(() => {
    throw new Error("GitHub should not be called for invalid merge input");
  }, async () => {
    const response = await jsonPost("/api/github/pulls/merge", { number: 494, method: "merge" });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.field, "method");
  });
});

test("merge validation requires expected head SHA before GitHub calls", async () => {
  await withMockedFetch(() => {
    throw new Error("GitHub should not be called without expectedHeadSha");
  }, async () => {
    const response = await jsonPost("/api/github/pulls/merge", { number: 494 });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.field, "expectedHeadSha");
  });
});

test("merge endpoint rejects non-agent or unsafe pull requests before merging", async () => {
  const cases = [
    {
      body: {
        state: "closed",
        draft: false,
        head: { ref: "agent/closed", repo: { full_name: "fol2/ks2-mastery" } },
        base: { ref: "main", repo: { full_name: "fol2/ks2-mastery" } }
      },
      field: "number"
    },
    {
      body: {
        state: "open",
        draft: true,
        head: { ref: "agent/draft", repo: { full_name: "fol2/ks2-mastery" } },
        base: { ref: "main", repo: { full_name: "fol2/ks2-mastery" } }
      },
      field: "number"
    },
    {
      body: {
        state: "open",
        draft: false,
        head: { ref: "agent/wrong-base", repo: { full_name: "fol2/ks2-mastery" } },
        base: { ref: "develop", repo: { full_name: "fol2/ks2-mastery" } }
      },
      field: "base"
    },
    {
      body: {
        state: "open",
        draft: false,
        head: { ref: "feature/not-agent", repo: { full_name: "fol2/ks2-mastery" } },
        base: { ref: "main", repo: { full_name: "fol2/ks2-mastery" } }
      },
      field: "head"
    },
    {
      body: {
        state: "open",
        draft: false,
        head: { ref: "agent/fork", repo: { full_name: "someone/ks2-mastery" } },
        base: { ref: "main", repo: { full_name: "fol2/ks2-mastery" } }
      },
      field: "head"
    }
  ];

  for (const [index, testCase] of cases.entries()) {
    await withMockedFetch((url, init) => {
      assert.equal(url, `https://api.github.com/repos/fol2/ks2-mastery/pulls/${500 + index}`);
      assert.equal(init.method, "GET");
      return Response.json({ number: 500 + index, ...testCase.body });
    }, async (calls) => {
      const response = await jsonPost("/api/github/pulls/merge", {
        number: 500 + index,
        expectedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      });
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.field, testCase.field);
      assert.equal(calls.length, 1);
    });
  }
});

test("merge endpoint rejects stale expected head SHA before merging", async () => {
  await withMockedFetch((url, init) => {
    assert.equal(url, "https://api.github.com/repos/fol2/ks2-mastery/pulls/499");
    assert.equal(init.method, "GET");
    return Response.json({
      number: 499,
      state: "open",
      draft: false,
      head: {
        ref: "agent/stale-head",
        sha: "cccccccccccccccccccccccccccccccccccccccc",
        repo: { full_name: "fol2/ks2-mastery" }
      },
      base: {
        ref: "main",
        repo: { full_name: "fol2/ks2-mastery" }
      }
    });
  }, async (calls) => {
    const response = await jsonPost("/api/github/pulls/merge", {
      number: 499,
      expectedHeadSha: "dddddddddddddddddddddddddddddddddddddddd"
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.field, "expectedHeadSha");
    assert.equal(calls.length, 1);
  });
});

test("limit parsing defaults and caps conservative values", () => {
  assert.equal(parseLimit(null), 5);
  assert.equal(parseLimit("0"), 5);
  assert.equal(parseLimit("abc"), 5);
  assert.equal(parseLimit("3"), 3);
  assert.equal(parseLimit("200"), 10);
});
