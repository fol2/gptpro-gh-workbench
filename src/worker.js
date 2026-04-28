const SERVICE_NAME = "GPTPro GitHub Workbench Portal";
const PROJECT_REPO = "fol2/gptpro-gh-workbench";
const TARGET_REPO = "fol2/ks2-mastery";
const GITHUB_API_BASE = "https://api.github.com/repos/fol2/ks2-mastery";
const MAX_GITHUB_LIMIT = 10;
const DEFAULT_GITHUB_LIMIT = 5;

const READ_ENDPOINTS = [
  "/api/status",
  "/api/github/repo",
  "/api/github/prs?limit=5",
  "/api/github/issues?limit=5",
  "/api/actions"
];

const ACTIONS = [
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
    label: "Create branches, comments, issues, or pull requests",
    status: "disabled",
    reason: "Write authentication is intentionally disabled in this foundation slice."
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
    reason: "Secret handling is out of scope for the read-only portal foundation."
  }
];

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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
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

  if (request.method !== "GET") {
    return url.pathname.startsWith("/api/")
      ? jsonResponse({ error: "method_not_allowed", message: "Only GET is enabled in this read-only portal." }, 405)
      : htmlResponse(renderHtmlError(405, "Method not allowed", "Only GET requests are enabled in this read-only portal."), 405);
  }

  if (url.pathname === "/") {
    return htmlResponse(renderDashboard());
  }

  if (url.pathname === "/api/status") {
    return jsonResponse(buildStatus(), 200, { cors: true });
  }

  if (url.pathname === "/api/actions") {
    return jsonResponse({
      service: SERVICE_NAME,
      mode: "read-only foundation",
      actions: ACTIONS
    }, 200, { cors: true });
  }

  if (url.pathname === "/api/github/repo") {
    return jsonResponse(await fetchGitHubJson(""), 200, { cors: true });
  }

  if (url.pathname === "/api/github/prs") {
    const limit = parseLimit(url.searchParams.get("limit"));
    return jsonResponse(await fetchGitHubJson(`/pulls?state=open&per_page=${limit}`), 200, { cors: true });
  }

  if (url.pathname === "/api/github/issues") {
    const limit = parseLimit(url.searchParams.get("limit"));
    const issues = await fetchGitHubJson(`/issues?state=open&per_page=${limit}`);
    return jsonResponse(Array.isArray(issues) ? issues.filter((issue) => !issue.pull_request) : issues, 200, { cors: true });
  }

  if (url.pathname.startsWith("/api/")) {
    return jsonResponse({
      error: "not_found",
      message: "This API path is not allowlisted.",
      allowed_read_endpoints: READ_ENDPOINTS
    }, 404);
  }

  return htmlResponse(renderHtmlError(404, "Not found", "This browser path is not part of the portal foundation."), 404);
}

export function buildStatus() {
  return {
    service: SERVICE_NAME,
    project_repo: PROJECT_REPO,
    target_repo: TARGET_REPO,
    capability_mode: "read-only foundation",
    portal_status: "live/read-only foundation",
    executor_status: {
      connected: false,
      status: "not connected",
      note: "Private executor command execution is intentionally absent from this slice."
    },
    auth_write_status: {
      enabled: false,
      status: "disabled",
      note: "No GitHub token or write credential is accepted or echoed by this Worker."
    },
    allowlisted_read_endpoints: READ_ENDPOINTS,
    github_api_base: GITHUB_API_BASE
  };
}

export function parseLimit(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_GITHUB_LIMIT;
  }

  return Math.min(parsed, MAX_GITHUB_LIMIT);
}

async function fetchGitHubJson(path) {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "gptpro-gh-workbench-readonly-portal",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  const payload = await response.json().catch(() => ({
    message: "GitHub returned a non-JSON response."
  }));

  if (!response.ok) {
    return {
      error: "github_request_failed",
      status: response.status,
      message: payload.message ?? "GitHub request failed."
    };
  }

  return payload;
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

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function isSafeApiPath(pathname) {
  return [
    "/api/status",
    "/api/actions",
    "/api/github/repo",
    "/api/github/prs",
    "/api/github/issues"
  ].includes(pathname);
}

function renderDashboard() {
  const status = buildStatus();
  const actionRows = ACTIONS.map((action) => `
        <tr>
          <td>${escapeHtml(action.id)}</td>
          <td>${escapeHtml(action.status)}</td>
          <td>${escapeHtml(action.label)}</td>
        </tr>`).join("");
  const endpointLinks = READ_ENDPOINTS.map((endpoint) => `
        <li><a href="${escapeAttribute(endpoint)}">${escapeHtml(endpoint)}</a></li>`).join("");

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
      <p>Portal foundation for <a href="https://github.com/${TARGET_REPO}">${TARGET_REPO}</a>. It is read-only, browser-readable, and API-readable; the private executor is not connected yet.</p>
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
              <strong>Executor</strong>
              <span class="warn">${escapeHtml(status.executor_status.status)}</span>
            </div>
            <div class="metric">
              <strong>Auth and writes</strong>
              <span class="disabled">${escapeHtml(status.auth_write_status.status)}</span>
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
            <li><a href="https://github.com/${TARGET_REPO}">${TARGET_REPO}</a> target repo</li>
          </ul>
        </section>
      </aside>
    </main>
  </body>
</html>`;
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
