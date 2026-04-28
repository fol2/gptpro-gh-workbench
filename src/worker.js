const SERVICE_NAME = "GPTPro GitHub Workbench Portal";
const PROJECT_REPO = "fol2/gptpro-gh-workbench";
const TARGET_REPO = "fol2/ks2-mastery";
const ALLOWED_TARGET_REPOS = [TARGET_REPO, PROJECT_REPO];
const TARGET_DEFAULT_BRANCH = "main";
const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_API_BASE = `${GITHUB_API_ROOT}/repos/${TARGET_REPO}`;
const MAX_GITHUB_LIMIT = 10;
const DEFAULT_GITHUB_LIMIT = 5;
const MAX_JSON_BYTES = 32_768;
const MAX_TEXT_BYTES = 65_536;
const DEFAULT_MERGE_METHOD = "squash";
const SESSION_COOKIE_NAME = "gptpro_workbench_session";
const SESSION_QUERY_PARAM = "session";
const WORKBENCH_SESSION_HEADER = "X-Workbench-Session";
const WRITE_READY_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

const READ_ENDPOINTS = [
  "/api/action/readiness",
  "/api/status",
  "/api/github/auth",
  "/api/github/repo",
  "/api/github/prs?limit=5",
  "/api/github/issues?limit=5",
  "/api/actions"
];

const WRITE_ENDPOINTS = [
  "POST /api/github/issues",
  "POST /api/github/comments",
  "POST /api/github/branches",
  "POST /api/github/branches/delete",
  "POST /api/github/files",
  "POST /api/github/pulls",
  "POST /api/github/pulls/close",
  "POST /api/github/pulls/merge"
];

function buildActions(env = {}) {
  const writeEnabled = hasGitHubToken(env);

  return [
  {
    id: "workbench.action.readiness",
    label: "Verify broker readiness before any GitHub action",
    status: "enabled",
    method: "GET",
    endpoint: "/api/action/readiness"
  },
  {
    id: "github.repo.read",
    label: "Read target repository metadata",
    status: "enabled",
    method: "GET",
    endpoint: "/api/github/repo"
  },
  {
    id: "github.prs.read",
    label: "List public open pull requests",
    status: "enabled",
    method: "GET",
    endpoint: "/api/github/prs"
  },
  {
    id: "github.issues.read",
    label: "List public open issues",
    status: "enabled",
    method: "GET",
    endpoint: "/api/github/issues"
  },
  {
    id: "github.write",
    label: "Create branches, comments, issues, pull requests, cleanup, or guarded merges",
    status: writeEnabled ? "enabled" : "disabled",
    method: "POST",
    endpoint: "/api/github/*",
    reason: writeEnabled
      ? "Enabled for allowlisted operations on approved repositories only; merges are limited to open non-draft agent pull requests into main."
      : "Disabled until GH_TOKEN is configured as a Worker secret."
  },
  {
    id: "executor.command",
    label: "Run private executor jobs or shell commands",
    status: "disabled",
    reason: "The private executor is not connected yet."
  },
  {
    id: "secrets.manage",
    label: "Read or manage secrets",
    status: "disabled",
    reason: "Secret handling is never exposed through the public Worker."
  }
  ];
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "style-src 'unsafe-inline'",
    "connect-src 'self'"
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Resource-Policy": "same-origin"
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": `Accept, Content-Type, ${WORKBENCH_SESSION_HEADER}`,
  "Access-Control-Max-Age": "86400"
};

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

export async function handleRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && isSafeApiPath(url.pathname)) {
    return new Response(null, {
      status: 204,
      headers: {
        ...SECURITY_HEADERS,
        ...CORS_HEADERS,
        "Vary": "Origin"
      }
    });
  }

  if (!["GET", "POST"].includes(request.method)) {
    return url.pathname.startsWith("/api/")
      ? jsonResponse({ error: "method_not_allowed", message: "Only GET and allowlisted POST requests are enabled." }, 405)
      : htmlResponse(renderHtmlError(405, "Method not allowed", "Only GET requests are enabled for browser paths."), 405);
  }

  if (request.method === "POST" && !isWriteApiPath(url.pathname)) {
    return url.pathname.startsWith("/api/")
      ? jsonResponse({ error: "method_not_allowed", message: "POST is only enabled for allowlisted GitHub write endpoints." }, 405)
      : htmlResponse(renderHtmlError(405, "Method not allowed", "Only GET requests are enabled for browser paths."), 405);
  }

  const session = getSessionContext(request, env);
  if (!session.valid) {
    return url.pathname.startsWith("/api/")
      ? jsonResponse({
        error: "unauthorised",
        message: "A valid workbench session is required."
      }, 401)
      : htmlResponse(renderHtmlError(
        401,
        "Session required",
        "This portal is protected. Open it with a short-lived workbench session link."
      ), 401);
  }

  if (request.method === "POST") {
    return handleGitHubWriteRequest(request, env, url.pathname);
  }

  if (url.pathname === "/") {
    return htmlResponse(renderDashboard({
      env,
      sessionQueryToken: session.source === "query" ? session.token : null
    }), 200, {
      headers: sessionCookieHeaders(session)
    });
  }

  if (url.pathname === "/api/status") {
    return jsonResponse(buildStatus(env), 200, { cors: true });
  }

  if (url.pathname === "/api/actions") {
    return jsonResponse({
      service: SERVICE_NAME,
      mode: hasGitHubToken(env) ? "github write broker" : "read-only without GH_TOKEN",
      actions: buildActions(env)
    }, 200, { cors: true });
  }

  if (url.pathname === "/api/action/readiness") {
    const targetRepo = targetRepoFromQuery(url);
    if (!targetRepo.ok) return githubResponse(targetRepo);
    return githubResponse(await buildActionReadiness(env, targetRepo.value));
  }

  if (url.pathname === "/api/github/auth") {
    const targetRepo = targetRepoFromQuery(url);
    if (!targetRepo.ok) return githubResponse(targetRepo);
    return githubResponse(await buildGitHubAuthStatus(env, targetRepo.value));
  }

  if (url.pathname === "/api/github/repo") {
    const targetRepo = targetRepoFromQuery(url);
    if (!targetRepo.ok) return githubResponse(targetRepo);
    return githubResponse(await fetchGitHubJson(`/repos/${targetRepo.value}`));
  }

  if (url.pathname === "/api/github/prs") {
    const targetRepo = targetRepoFromQuery(url);
    if (!targetRepo.ok) return githubResponse(targetRepo);
    const limit = parseLimit(url.searchParams.get("limit"));
    return githubResponse(await fetchGitHubJson(`/repos/${targetRepo.value}/pulls?state=open&per_page=${limit}`));
  }

  if (url.pathname === "/api/github/issues") {
    const targetRepo = targetRepoFromQuery(url);
    if (!targetRepo.ok) return githubResponse(targetRepo);
    const limit = parseLimit(url.searchParams.get("limit"));
    const result = await fetchGitHubJson(`/repos/${targetRepo.value}/issues?state=open&per_page=${limit}`);
    if (!result.ok) {
      return githubResponse(result);
    }

    const issues = result.payload;
    return jsonResponse(Array.isArray(issues) ? issues.filter((issue) => !issue.pull_request) : issues, 200, { cors: true });
  }

  if (url.pathname.startsWith("/api/")) {
    return jsonResponse({
      error: "not_found",
      message: "This API path is not allowlisted.",
      allowed_read_endpoints: READ_ENDPOINTS,
      allowed_write_endpoints: WRITE_ENDPOINTS
    }, 404);
  }

  return htmlResponse(renderHtmlError(404, "Not found", "This browser path is not part of the portal foundation."), 404);
}

export function buildStatus(env = {}) {
  const writeEnabled = hasGitHubToken(env);

  return {
    service: SERVICE_NAME,
    project_repo: PROJECT_REPO,
    target_repo: TARGET_REPO,
    default_target_repo: TARGET_REPO,
    allowed_target_repos: ALLOWED_TARGET_REPOS,
    capability_mode: writeEnabled ? "session-protected github write broker" : "read-only without GH_TOKEN",
    portal_status: writeEnabled ? "responding/github write broker" : "responding/read-only without GH_TOKEN",
    deployment_status: env.WORKBENCH_DEPLOYMENT_STATUS || "not claimed until deployed and live-smoked",
    access_status: "session required",
    executor_status: {
      connected: false,
      status: "not connected",
      note: "Private executor command execution is intentionally absent from this slice."
    },
    auth_write_status: {
      enabled: writeEnabled,
      status: writeEnabled ? "enabled via GH_TOKEN Worker secret" : "disabled/missing GH_TOKEN",
      note: writeEnabled
        ? `GitHub writes are constrained to allowlisted repository API operations on ${ALLOWED_TARGET_REPOS.join(", ")}; the token is never returned.`
        : "No GitHub write credential is configured for this Worker."
    },
    allowlisted_read_endpoints: READ_ENDPOINTS,
    allowlisted_write_endpoints: WRITE_ENDPOINTS,
    github_api_base: GITHUB_API_BASE,
    github_api_bases: ALLOWED_TARGET_REPOS.map((repo) => `${GITHUB_API_ROOT}/repos/${repo}`)
  };
}

export function parseLimit(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_GITHUB_LIMIT;
  }

  return Math.min(parsed, MAX_GITHUB_LIMIT);
}

export async function buildActionReadiness(env = {}, targetRepo = TARGET_REPO) {
  const statusPayload = buildStatus(env);
  const actionsPayload = {
    service: SERVICE_NAME,
    mode: hasGitHubToken(env) ? "github write broker" : "read-only without GH_TOKEN",
    actions: buildActions(env)
  };
  const checks = [
    readinessCheck("/api/status", { ok: true, status: 200 }),
    readinessCheck("/api/actions", { ok: true, status: 200 })
  ];

  const repo = await fetchGitHubJson(`/repos/${targetRepo}`, env);
  checks.push(readinessCheck("/api/github/repo", repo));
  if (!repo.ok) {
    return readinessFailure(repo, checks, targetRepo, "github_upstream_failure", "Repository read check failed.");
  }

  const auth = await buildGitHubAuthStatus(env, targetRepo);
  checks.push(readinessCheck("/api/github/auth", auth));
  if (!auth.ok) {
    return readinessFailure(
      auth,
      checks,
      targetRepo,
      auth.payload?.error || "github_auth_not_ready",
      auth.payload?.message || "GitHub auth check failed."
    );
  }

  const permission = auth.payload?.repository?.viewer_permission || "UNKNOWN";
  if (!WRITE_READY_PERMISSIONS.has(permission)) {
    return {
      ok: false,
      status: 403,
      payload: {
        ok: false,
        classification: "insufficient_repository_permission",
        message: "The authenticated GitHub viewer does not have write-capable permission for the target repository.",
        target_repo: targetRepo,
        viewer: auth.payload?.github_user?.login || null,
        permission,
        checks
      }
    };
  }

  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      classification: "broker_read_ready",
      message: "Broker status, action list, repository read, and GitHub auth checks passed.",
      target_repo: targetRepo,
      viewer: auth.payload?.github_user?.login || null,
      permission,
      actions: actionsPayload.actions,
      capability_mode: statusPayload.capability_mode,
      auth_channel: WORKBENCH_SESSION_HEADER,
      operation_model: "ChatGPT Pro API connector/action over fixed broker endpoints",
      runtime_install_required: false,
      checks
    }
  };
}

async function buildGitHubAuthStatus(env, targetRepo = TARGET_REPO) {
  if (!hasGitHubToken(env)) {
    return {
      ok: false,
      status: 503,
      payload: {
        error: "github_token_missing",
        message: "GH_TOKEN is not configured for this Worker."
      }
    };
  }

  const user = await fetchGitHubJson("/user", env);
  if (!user.ok) {
    return user;
  }

  const repo = await fetchGitHubJson(`/repos/${targetRepo}`, env);
  if (!repo.ok) {
    return repo;
  }

  return {
    ok: true,
    status: 200,
    payload: {
      service: SERVICE_NAME,
      target_repo: targetRepo,
      allowed_target_repos: ALLOWED_TARGET_REPOS,
      authenticated: true,
      github_user: {
        login: user.payload.login,
        id: user.payload.id
      },
      repository: {
        full_name: repo.payload.full_name,
        default_branch: repo.payload.default_branch,
        viewer_permission: permissionLabel(repo.payload.permissions),
        permissions: repo.payload.permissions ?? null
      },
      capabilities: {
        create_issue: true,
        create_issue_or_pr_comment: true,
        create_agent_branch: true,
        delete_agent_branch: true,
        put_file_on_agent_branch: true,
        create_pr_from_agent_branch: true,
        close_pull_request: true,
        merge_agent_pull_request: true,
        direct_main_write: false,
        merge: "agent_pr_squash_only",
        workflow_edit: false,
        secrets_or_admin: false,
        shell_execution: false
      }
    }
  };
}

async function handleGitHubWriteRequest(request, env, pathname) {
  if (!hasGitHubToken(env)) {
    return jsonResponse({
      error: "github_token_missing",
      message: "GH_TOKEN is not configured for this Worker."
    }, 503, { cors: true });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return jsonResponse(bodyResult.payload, bodyResult.status, { cors: true });
  }

  const body = bodyResult.payload;
  const targetRepo = resolveTargetRepo(body.repo);
  if (!targetRepo.ok) {
    return jsonResponse(targetRepo.payload, targetRepo.status, { cors: true });
  }

  if (pathname === "/api/github/issues") {
    return githubResponse(await createIssue(body, env, targetRepo.value));
  }

  if (pathname === "/api/github/comments") {
    return githubResponse(await createIssueComment(body, env, targetRepo.value));
  }

  if (pathname === "/api/github/branches") {
    return githubResponse(await createAgentBranch(body, env, targetRepo.value));
  }

  if (pathname === "/api/github/branches/delete") {
    return githubResponse(await deleteAgentBranch(body, env, targetRepo.value));
  }

  if (pathname === "/api/github/files") {
    return githubResponse(await putRepositoryFile(body, env, targetRepo.value));
  }

  if (pathname === "/api/github/pulls") {
    return githubResponse(await createPullRequest(body, env, targetRepo.value));
  }

  if (pathname === "/api/github/pulls/close") {
    return githubResponse(await closePullRequest(body, env, targetRepo.value));
  }

  if (pathname === "/api/github/pulls/merge") {
    return githubResponse(await mergePullRequest(body, env, targetRepo.value));
  }

  return jsonResponse({
    error: "not_found",
    message: "This write path is not allowlisted.",
    allowed_write_endpoints: WRITE_ENDPOINTS
  }, 404, { cors: true });
}

async function readJsonBody(request) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      status: 415,
      payload: {
        error: "unsupported_media_type",
        message: "Write requests must use application/json."
      }
    };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES) {
    return {
      ok: false,
      status: 413,
      payload: {
        error: "request_too_large",
        message: `JSON request bodies are capped at ${MAX_JSON_BYTES} bytes.`
      }
    };
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        ok: false,
        status: 400,
        payload: {
          error: "invalid_json_object",
          message: "Request body must be a JSON object."
        }
      };
    }

    return { ok: true, status: 200, payload };
  } catch {
    return {
      ok: false,
      status: 400,
      payload: {
        error: "invalid_json",
        message: "Request body must be valid JSON."
      }
    };
  }
}

async function createIssue(body, env, targetRepo) {
  const title = boundedText(body.title, "title", 256, { required: true });
  if (!title.ok) return title;

  const issueBody = boundedText(body.body ?? "", "body", 8192);
  if (!issueBody.ok) return issueBody;

  return fetchGitHubJson(`/repos/${targetRepo}/issues`, env, {
    method: "POST",
    body: {
      title: title.value,
      body: issueBody.value
    }
  });
}

async function createIssueComment(body, env, targetRepo) {
  const number = positiveInteger(body.number, "number");
  if (!number.ok) return number;

  const commentBody = boundedText(body.body, "body", 8192, { required: true });
  if (!commentBody.ok) return commentBody;

  return fetchGitHubJson(`/repos/${targetRepo}/issues/${number.value}/comments`, env, {
    method: "POST",
    body: {
      body: commentBody.value
    }
  });
}

async function createAgentBranch(body, env, targetRepo) {
  const branch = validateAgentBranch(body.branch);
  if (!branch.ok) return branch;

  const base = await fetchGitHubJson(`/repos/${targetRepo}/git/ref/heads/${TARGET_DEFAULT_BRANCH}`, env);
  if (!base.ok) return base;

  const sha = base.payload?.object?.sha;
  if (!isSha(sha)) {
    return validationError("from_sha", "Base branch SHA could not be resolved.");
  }

  const created = await fetchGitHubJson(`/repos/${targetRepo}/git/refs`, env, {
    method: "POST",
    body: {
      ref: `refs/heads/${branch.value}`,
      sha
    }
  });

  return normaliseReferenceAlreadyExists(created);
}

async function putRepositoryFile(body, env, targetRepo) {
  const branch = validateAgentBranch(body.branch);
  if (!branch.ok) return branch;

  const path = validateRepositoryPath(body.path);
  if (!path.ok) return path;

  const content = boundedText(body.content, "content", MAX_TEXT_BYTES, { required: true, trim: false });
  if (!content.ok) return content;

  const message = boundedText(body.message || `Update ${path.value}`, "message", 200, { required: true });
  if (!message.ok) return message;

  const filePath = encodeRepoPath(path.value);
  const existing = await fetchGitHubJson(
    `/repos/${targetRepo}/contents/${filePath}?ref=${encodeURIComponent(branch.value)}`,
    env
  );

  if (!existing.ok && existing.payload?.upstream_status !== 404) {
    return existing;
  }

  const sha = existing.ok ? existing.payload?.sha : null;
  return fetchGitHubJson(`/repos/${targetRepo}/contents/${filePath}`, env, {
    method: "PUT",
    body: {
      message: message.value,
      content: base64EncodeUtf8(content.value),
      branch: branch.value,
      ...(sha ? { sha } : {})
    }
  });
}

async function createPullRequest(body, env, targetRepo) {
  const branch = validateAgentBranch(body.branch || body.head);
  if (!branch.ok) return branch;

  const title = boundedText(body.title, "title", 256, { required: true });
  if (!title.ok) return title;

  const prBody = boundedText(body.body ?? "", "body", 8192);
  if (!prBody.ok) return prBody;

  return fetchGitHubJson(`/repos/${targetRepo}/pulls`, env, {
    method: "POST",
    body: {
      title: title.value,
      head: branch.value,
      base: TARGET_DEFAULT_BRANCH,
      body: prBody.value,
      draft: Boolean(body.draft)
    }
  });
}

async function closePullRequest(body, env, targetRepo) {
  const number = positiveInteger(body.number, "number");
  if (!number.ok) return number;

  return fetchGitHubJson(`/repos/${targetRepo}/pulls/${number.value}`, env, {
    method: "PATCH",
    body: {
      state: "closed"
    }
  });
}

async function mergePullRequest(body, env, targetRepo) {
  const number = positiveInteger(body.number, "number");
  if (!number.ok) return number;

  const method = mergeMethod(body.method);
  if (!method.ok) return method;

  const expectedHeadSha = requiredSha(body.expectedHeadSha ?? body.sha, "expectedHeadSha");
  if (!expectedHeadSha.ok) return expectedHeadSha;

  const title = boundedText(body.title ?? body.commit_title ?? "", "title", 256);
  if (!title.ok) return title;

  const message = boundedText(body.message ?? body.commit_message ?? "", "message", 8192);
  if (!message.ok) return message;

  const pullRequest = await fetchGitHubJson(`/repos/${targetRepo}/pulls/${number.value}`, env);
  if (!pullRequest.ok) return pullRequest;

  const guard = validateMergeTarget(pullRequest.payload, targetRepo);
  if (!guard.ok) return guard;

  const headSha = pullRequest.payload?.head?.sha;
  if (expectedHeadSha.value && typeof headSha === "string" && expectedHeadSha.value !== headSha.toLowerCase()) {
    return validationError("expectedHeadSha", "expectedHeadSha does not match the current pull request head SHA.");
  }

  const mergeBody = {
    merge_method: method.value,
    ...(title.value ? { commit_title: title.value } : {}),
    ...(message.value ? { commit_message: message.value } : {}),
    ...(expectedHeadSha.value ? { sha: expectedHeadSha.value } : {})
  };

  const merged = await fetchGitHubJson(`/repos/${targetRepo}/pulls/${number.value}/merge`, env, {
    method: "PUT",
    body: mergeBody
  });
  if (!merged.ok) return merged;

  return {
    ok: true,
    status: 200,
    payload: {
      merged: Boolean(merged.payload?.merged),
      number: number.value,
      method: method.value,
      sha: merged.payload?.sha ?? null,
      message: merged.payload?.message ?? "Pull request merged.",
      html_url: pullRequest.payload?.html_url ?? null,
      repository: targetRepo,
      base: TARGET_DEFAULT_BRANCH,
      head: {
        ref: pullRequest.payload?.head?.ref,
        sha: headSha ?? null
      }
    }
  };
}

async function deleteAgentBranch(body, env, targetRepo) {
  const branch = validateAgentBranch(body.branch);
  if (!branch.ok) return branch;

  const refPath = `heads/${encodeRepoPath(branch.value)}`;
  const deleted = await fetchGitHubJson(`/repos/${targetRepo}/git/refs/${refPath}`, env, {
    method: "DELETE"
  });
  if (!deleted.ok) return deleted;

  return {
    ok: true,
    status: 200,
    payload: {
      deleted: true,
      repository: targetRepo,
      branch: branch.value,
      ref: `refs/heads/${branch.value}`
    }
  };
}

async function fetchGitHubJson(path, env = {}, options = {}) {
  try {
    const headers = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "gptpro-gh-workbench-broker",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(hasGitHubToken(env) ? { "Authorization": `Bearer ${env.GH_TOKEN || env.GITHUB_TOKEN}` } : {})
    };

    const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...headers,
        ...(options.headers ?? {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });

    const payload = await response.json().catch(() => ({
      message: "GitHub returned a non-JSON response."
    }));

    if (!response.ok) {
      return {
        ok: false,
        status: upstreamStatus(response.status),
        payload: {
          error: "github_request_failed",
          upstream_status: response.status,
          message: payload.message ?? "GitHub request failed."
        }
      };
    }

    return { ok: true, status: 200, payload };
  } catch {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "github_request_failed",
        message: "GitHub request could not be completed."
      }
    };
  }
}

function githubResponse(result) {
  return jsonResponse(result.payload, result.status, { cors: true });
}

function readinessCheck(endpoint, result) {
  return {
    endpoint,
    status: result.status ?? null,
    classification: result.ok ? "ok" : readinessClassification(result),
    ok: Boolean(result.ok)
  };
}

function readinessClassification(result) {
  const error = result.payload?.error;
  if (error === "github_request_failed") return "github_upstream_failure";
  if (typeof error === "string" && error) return error;
  return "broker_readiness_failure";
}

function readinessFailure(result, checks, targetRepo, classification, message) {
  return {
    ok: false,
    status: result.status || 503,
    payload: {
      ok: false,
      classification,
      message,
      target_repo: targetRepo,
      checks,
      payload: result.payload || {}
    }
  };
}

function hasGitHubToken(env = {}) {
  return Boolean(env.GH_TOKEN || env.GITHUB_TOKEN);
}

function permissionLabel(permissions = {}) {
  if (permissions?.admin) return "ADMIN";
  if (permissions?.maintain) return "MAINTAIN";
  if (permissions?.push) return "WRITE";
  if (permissions?.triage) return "TRIAGE";
  if (permissions?.pull) return "READ";
  return "UNKNOWN";
}

function targetRepoFromQuery(url) {
  return resolveTargetRepo(url.searchParams.get("repo"));
}

function resolveTargetRepo(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: TARGET_REPO };
  }

  if (typeof value !== "string") {
    return validationError("repo", `repo must be one of: ${ALLOWED_TARGET_REPOS.join(", ")}.`);
  }

  const repo = value.trim();
  if (!ALLOWED_TARGET_REPOS.includes(repo)) {
    return validationError("repo", `repo must be one of: ${ALLOWED_TARGET_REPOS.join(", ")}.`);
  }

  return { ok: true, value: repo };
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return validationError(field, `${field} must be a positive integer.`);
  }

  return { ok: true, value: parsed };
}

function mergeMethod(value) {
  const method = typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : DEFAULT_MERGE_METHOD;

  if (method !== DEFAULT_MERGE_METHOD) {
    return validationError("method", "Only squash merges are enabled for this broker.");
  }

  return { ok: true, value: method };
}

function optionalSha(value, field) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }

  if (!isSha(value)) {
    return validationError(field, `${field} must be a 40-character Git SHA.`);
  }

  return { ok: true, value: value.toLowerCase() };
}

function requiredSha(value, field) {
  if (value === undefined || value === null || value === "") {
    return validationError(field, `${field} is required for guarded merges.`);
  }

  return optionalSha(value, field);
}

function boundedText(value, field, maxBytes, options = {}) {
  if (typeof value !== "string") {
    if (options.required) {
      return validationError(field, `${field} must be a string.`);
    }
    return { ok: true, value: "" };
  }

  const trimmed = options.trim === false ? value : value.trim();
  if (options.required && trimmed.length === 0) {
    return validationError(field, `${field} is required.`);
  }

  if (new TextEncoder().encode(trimmed).length > maxBytes) {
    return validationError(field, `${field} is capped at ${maxBytes} bytes.`);
  }

  return { ok: true, value: trimmed };
}

function validateAgentBranch(value) {
  if (typeof value !== "string") {
    return validationError("branch", "branch must be a string beginning with agent/.");
  }

  const branch = value.trim();
  const invalidReason = invalidAgentBranchReason(branch);
  if (invalidReason) {
    return validationError("branch", invalidReason);
  }

  return { ok: true, value: branch };
}

function invalidAgentBranchReason(branch) {
  if (!branch.startsWith("agent/") || branch === "agent/") {
    return "branch must begin with agent/ and include a task name.";
  }

  if (branch === TARGET_DEFAULT_BRANCH || branch.startsWith("refs/")) {
    return "direct writes to main or refs/* are disabled.";
  }

  if (branch.length > 100) {
    return "branch is capped at 100 characters.";
  }

  if (
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    /[\s~^:?*[\]\\]/.test(branch)
  ) {
    return "branch contains characters that are not allowed for workbench agent branches.";
  }

  return null;
}

function validateRepositoryPath(value) {
  if (typeof value !== "string") {
    return validationError("path", "path must be a relative repository path.");
  }

  const path = value.trim();
  if (!path || path.length > 250 || path.startsWith("/") || path.includes("\0")) {
    return validationError("path", "path must be a non-empty relative repository path capped at 250 characters.");
  }

  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return validationError("path", "path must not contain empty, current, or parent directory segments.");
  }

  if (path.toLowerCase().startsWith(".github/workflows/")) {
    return validationError("path", "workflow file edits are disabled for this broker.");
  }

  return { ok: true, value: path };
}

function validateMergeTarget(pullRequest, targetRepo) {
  if (!pullRequest || typeof pullRequest !== "object") {
    return validationError("number", "Pull request metadata could not be validated.");
  }

  if (pullRequest.state !== "open") {
    return validationError("number", "Only open pull requests can be merged by this broker.");
  }

  if (pullRequest.draft === true) {
    return validationError("number", "Draft pull requests cannot be merged by this broker.");
  }

  if (pullRequest.base?.ref !== TARGET_DEFAULT_BRANCH || pullRequest.base?.repo?.full_name !== targetRepo) {
    return validationError("base", `Only pull requests targeting ${targetRepo}:${TARGET_DEFAULT_BRANCH} can be merged by this broker.`);
  }

  if (pullRequest.head?.repo?.full_name !== targetRepo) {
    return validationError("head", `Only ${targetRepo} head branches can be merged by this broker.`);
  }

  const headRef = pullRequest.head?.ref;
  if (typeof headRef !== "string" || invalidAgentBranchReason(headRef)) {
    return validationError("head", "Only agent/... head branches can be merged by this broker.");
  }

  if (pullRequest.mergeable === false) {
    return validationError("mergeable", "GitHub reports this pull request is not mergeable.");
  }

  return { ok: true };
}

function validationError(field, message) {
  return {
    ok: false,
    status: 400,
    payload: {
      error: "validation_failed",
      field,
      message
    }
  };
}

function isSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function normaliseReferenceAlreadyExists(result) {
  if (result.ok || result.payload?.upstream_status !== 422) {
    return result;
  }

  return {
    ok: false,
    status: 409,
    payload: {
      error: "github_reference_exists",
      upstream_status: 422,
      message: result.payload.message || "The requested branch already exists."
    }
  };
}

function encodeRepoPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function base64EncodeUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function upstreamStatus(status) {
  if (status === 403 || status === 429) {
    return 503;
  }

  if (status >= 400 && status < 500) {
    return 502;
  }

  if (status >= 500) {
    return 502;
  }

  return 502;
}

function getSessionContext(request, env = {}) {
  const expected = env.WORKBENCH_SESSION_TOKEN;
  if (!expected) {
    return { valid: false, source: "missing-secret", token: null };
  }

  const url = new URL(request.url);
  const suppliedQueryToken = url.searchParams.get(SESSION_QUERY_PARAM);
  const suppliedHeaderToken = request.headers.get(WORKBENCH_SESSION_HEADER);
  const suppliedCookieToken = readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);

  if (safeEqual(suppliedHeaderToken, expected)) {
    return { valid: true, source: "header", token: null };
  }

  if (safeEqual(suppliedQueryToken, expected)) {
    return { valid: true, source: "query", token: suppliedQueryToken };
  }

  if (safeEqual(suppliedCookieToken, expected)) {
    return { valid: true, source: "cookie", token: suppliedCookieToken };
  }

  return { valid: false, source: "invalid", token: null };
}

function sessionCookieHeaders(session) {
  if (session.source !== "query" || !session.token) {
    return {};
  }

  return {
    "Set-Cookie": `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)}; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict; Secure`
  };
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=");
    }
  }

  return null;
}

function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function jsonResponse(body, status = 200, options = {}) {
  const corsHeaders = options.cors ? CORS_HEADERS : {};

  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(options.cors ? { "Vary": "Origin" } : {})
    }
  });
}

function htmlResponse(body, status = 200, options = {}) {
  return new Response(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...(options.headers ?? {}),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function isSafeApiPath(pathname) {
  return [
    "/api/status",
    "/api/action/readiness",
    "/api/actions",
    "/api/github/auth",
    "/api/github/repo",
    "/api/github/prs",
    "/api/github/issues",
    "/api/github/comments",
    "/api/github/branches",
    "/api/github/branches/delete",
    "/api/github/files",
    "/api/github/pulls",
    "/api/github/pulls/close",
    "/api/github/pulls/merge"
  ].includes(pathname);
}

function isWriteApiPath(pathname) {
  return [
    "/api/github/issues",
    "/api/github/comments",
    "/api/github/branches",
    "/api/github/branches/delete",
    "/api/github/files",
    "/api/github/pulls",
    "/api/github/pulls/close",
    "/api/github/pulls/merge"
  ].includes(pathname);
}

function renderDashboard({ env = {}, sessionQueryToken = null } = {}) {
  const status = buildStatus(env);
  const actions = buildActions(env);
  const actionRows = actions.map((action) => `
        <tr>
          <td>${escapeHtml(action.id)}</td>
          <td>${escapeHtml(action.status)}</td>
          <td>${escapeHtml(action.label)}</td>
        </tr>`).join("");
  const endpointLinks = READ_ENDPOINTS.map((endpoint) => `
        <li><a href="${escapeAttribute(endpointHref(endpoint, sessionQueryToken))}">${escapeHtml(endpoint)}</a></li>`).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(SERVICE_NAME)}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #17201b;
        --muted: #5f6b63;
        --line: #d9dfd8;
        --surface: #f7f8f5;
        --panel: #ffffff;
        --accent: #0b6b57;
        --warn: #9d5b00;
        --disabled: #7d3f37;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--surface);
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.45;
      }

      a {
        color: var(--accent);
        font-weight: 650;
      }

      a:focus-visible {
        outline: 3px solid #8bc9b9;
        outline-offset: 3px;
      }

      header,
      main {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
      }

      header {
        padding: 32px 0 18px;
        border-bottom: 1px solid var(--line);
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(1.8rem, 3vw, 2.75rem);
        line-height: 1.05;
      }

      h2 {
        margin: 0 0 14px;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      p {
        margin: 0;
        color: var(--muted);
      }

      main {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
        gap: 24px;
        padding: 24px 0 40px;
      }

      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 18px;
      }

      .status-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .metric {
        border-top: 3px solid var(--accent);
        padding-top: 10px;
      }

      .metric strong {
        display: block;
        font-size: 0.78rem;
        color: var(--muted);
        text-transform: uppercase;
      }

      .metric span {
        display: block;
        margin-top: 3px;
        font-size: 1.02rem;
        font-weight: 720;
      }

      .disabled {
        color: var(--disabled);
      }

      .warn {
        color: var(--warn);
      }

      ul {
        margin: 0;
        padding-left: 18px;
      }

      li + li {
        margin-top: 8px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.92rem;
      }

      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 10px 8px;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-size: 0.75rem;
        text-transform: uppercase;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.92em;
      }

      .stack {
        display: grid;
        gap: 16px;
      }

      @media (max-width: 800px) {
        main,
        .status-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(SERVICE_NAME)}</h1>
      <p>Session-protected workbench portal for ${ALLOWED_TARGET_REPOS.map((repo) => `<a href="https://github.com/${repo}">${repo}</a>`).join(" and ")}. It exposes fixed GitHub read endpoints and narrow write endpoints for agent branches, including guarded agent PR merges; shell execution and privileged repository administration are not exposed.</p>
    </header>
    <main>
      <div class="stack">
        <section aria-labelledby="status-heading">
          <h2 id="status-heading">Status</h2>
          <div class="status-grid">
            <div class="metric">
              <strong>Portal</strong>
              <span>${escapeHtml(status.portal_status)}</span>
            </div>
            <div class="metric">
              <strong>Capability</strong>
              <span>${escapeHtml(status.capability_mode)}</span>
            </div>
            <div class="metric">
              <strong>Deployment</strong>
              <span class="warn">${escapeHtml(status.deployment_status)}</span>
            </div>
            <div class="metric">
              <strong>Access</strong>
              <span>${escapeHtml(status.access_status)}</span>
            </div>
            <div class="metric">
              <strong>Executor</strong>
              <span class="warn">${escapeHtml(status.executor_status.status)}</span>
            </div>
            <div class="metric">
              <strong>Auth and writes</strong>
              <span class="${status.auth_write_status.enabled ? "" : "disabled"}">${escapeHtml(status.auth_write_status.status)}</span>
            </div>
          </div>
        </section>

        <section aria-labelledby="actions-heading">
          <h2 id="actions-heading">Actions</h2>
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Status</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>${actionRows}
            </tbody>
          </table>
        </section>
      </div>

      <aside class="stack">
        <section aria-labelledby="endpoints-heading">
          <h2 id="endpoints-heading">JSON endpoints</h2>
          <ul>${endpointLinks}
          </ul>
        </section>

        <section aria-labelledby="repos-heading">
          <h2 id="repos-heading">Repositories</h2>
          <ul>
            <li><a href="https://github.com/${PROJECT_REPO}">${PROJECT_REPO}</a> project repo</li>
            ${ALLOWED_TARGET_REPOS.map((repo) => `<li><a href="https://github.com/${repo}">${repo}</a> allowlisted target repo</li>`).join("\n            ")}
          </ul>
        </section>
      </aside>
    </main>
  </body>
</html>`;
}

function endpointHref(endpoint, sessionQueryToken) {
  if (!sessionQueryToken) {
    return endpoint;
  }

  const url = new URL(endpoint, "https://workbench.local");
  url.searchParams.set(SESSION_QUERY_PARAM, sessionQueryToken);
  return `${url.pathname}${url.search}`;
}

function renderHtmlError(status, title, message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${status} ${escapeHtml(title)} - ${escapeHtml(SERVICE_NAME)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f8f5;
        color: #17201b;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(680px, calc(100% - 32px));
        border-top: 4px solid #0b6b57;
        padding-top: 18px;
      }

      h1 {
        margin: 0 0 8px;
      }

      p {
        margin: 0 0 16px;
        color: #5f6b63;
      }

      a {
        color: #0b6b57;
        font-weight: 650;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${status} ${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a href="/">Return to portal status</a>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
