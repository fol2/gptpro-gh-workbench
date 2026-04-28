import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const DOC_PATHS = [
  "README.md",
  "@/2026-04-28-gptpro-gh-workbench-deployment-report.md",
  "docs/ks2-rest-broker-test-report-2026-04-28.md",
  "docs/ks2_rest_broker_test_2026-04-28.log",
  "docs/plans/2026-04-28-002-feat-operable-broker-client-plan.md"
];

const SECRET_PATTERNS = [
  /session=[A-Za-z0-9._~%+-]{8,}/i,
  /gptpro_workbench_session=[A-Za-z0-9._~%+-]{8,}/i,
  /github_pat_[A-Za-z0-9_]+/i,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/,
  /ghp_[A-Za-z0-9_]{16,}/i
];

async function readDocs() {
  const entries = await Promise.all(
    DOC_PATHS.map(async (path) => [path, await readFile(path, "utf8")])
  );

  return Object.fromEntries(entries);
}

test("workbench docs do not commit broker session or GitHub token material", async () => {
  const docs = await readDocs();

  for (const [path, content] of Object.entries(docs)) {
    for (const pattern of SECRET_PATTERNS) {
      assert.doesNotMatch(content, pattern, `${path} contains a secret-like value`);
    }
  }
});

test("runtime report distinguishes deployed broker capability from runtime operability", async () => {
  const docs = await readDocs();
  const report = docs["docs/ks2-rest-broker-test-report-2026-04-28.md"];
  const readme = docs["README.md"];

  assert.match(report, /could not operate it end-to-end/i);
  assert.match(report, /client path/i);
  assert.match(report, /Do not provide a GitHub token/i);
  assert.match(report, /Only run write smoke after the cleanup endpoints are deployed and authenticated/i);
  assert.match(readme, /POST \/api\/github\/pulls\/close/);
  assert.match(readme, /POST \/api\/github\/branches\/delete/);
  assert.match(readme, /There is no arbitrary URL fetch, generic proxy, shell execution/i);
});
