import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createActionPasscode, parseArgs } from "../scripts/create-action-passcode.mjs";

test("passcode CLI parses repo positional with safe defaults", () => {
  const options = parseArgs(["fol2/ks2-mastery"]);

  assert.equal(options.repo, "fol2/ks2-mastery");
  assert.equal(options.baseUrl, "https://gptpro-gh-workbench.eugnel.uk");
  assert.equal(options.write, true);
  assert.equal(options.merge, false);
  assert.equal(options.ttlSeconds, 600);
  assert.equal(options.sessionTtlSeconds, 18000);
  assert.equal(options.maxRequests, 500);
  assert.equal(options.getOnly, false);
});

test("passcode CLI supports optional repo and scope flags", () => {
  const readOnly = parseArgs(["--repo", "fol2/gptpro-gh-workbench", "--read-only", "--max-requests", "3"]);
  const merge = parseArgs(["fol2/ks2-mastery", "--merge", "--session-ttl-seconds", "300"]);

  assert.equal(readOnly.repo, "fol2/gptpro-gh-workbench");
  assert.equal(readOnly.write, false);
  assert.equal(readOnly.merge, false);
  assert.equal(readOnly.maxRequests, 3);
  assert.equal(merge.write, true);
  assert.equal(merge.merge, true);
  assert.equal(merge.sessionTtlSeconds, 300);
});

test("passcode CLI supports GET-only read passcodes with smaller defaults", () => {
  const options = parseArgs(["--get-only", "fol2/private-repo"]);
  const single = parseArgs(["--get-only", "fol2/private-repo", "--tier", "single"]);

  assert.equal(options.repo, "fol2/private-repo");
  assert.equal(options.getOnly, true);
  assert.equal(options.tier, "standard");
  assert.equal(options.write, false);
  assert.equal(options.merge, false);
  assert.equal(options.maxRequests, null);
  assert.equal(single.tier, "single");
  assert.throws(
    () => parseArgs(["--get-only", "fol2/private-repo", "--max-requests", "10"]),
    /GET read passcodes use --tier/
  );
});

test("passcode CLI sends a broker request without exposing the session token", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "workbench-passcode-"));
  const tokenFile = path.join(dir, "session-token");
  await writeFile(tokenFile, "test-session\n", "utf8");

  const payload = await createActionPasscode(parseArgs([
    "fol2/ks2-mastery",
    "--base-url",
    "https://workbench.example/",
    "--token-file",
    tokenFile,
    "--ttl-seconds",
    "120",
    "--session-ttl-seconds",
    "300",
    "--max-requests",
    "7"
  ]), async (url, init) => {
    assert.equal(url, "https://workbench.example/api/action/passcodes");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-Workbench-Session"], "test-session");
    assert.deepEqual(JSON.parse(init.body), {
      repo: "fol2/ks2-mastery",
      write: true,
      merge: false,
      ttlSeconds: 120,
      sessionTtlSeconds: 300,
      maxRequests: 7
    });

    return Response.json({
      ok: true,
      passcode: "WB-0000-0000-0000-0000",
      scope: { repo: "fol2/ks2-mastery" }
    });
  });

  assert.equal(payload.passcode, "WB-0000-0000-0000-0000");
});

test("passcode CLI sends GET-only passcodes to the read-passcode endpoint", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "workbench-get-passcode-"));
  const tokenFile = path.join(dir, "session-token");
  await writeFile(tokenFile, "test-session\n", "utf8");

  const payload = await createActionPasscode(parseArgs([
    "--get-only",
    "fol2/private-repo",
    "--base-url",
    "https://workbench.example/",
    "--token-file",
    tokenFile
  ]), async (url, init) => {
    assert.equal(url, "https://workbench.example/api/action/read-passcodes");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-Workbench-Session"], "test-session");
    assert.deepEqual(JSON.parse(init.body), {
      repo: "fol2/private-repo",
      tier: "standard"
    });

    return Response.json({
      ok: true,
      passcode: "WB-1111-1111-1111-1111",
      scope: { repo: "fol2/private-repo" }
    });
  });

  assert.equal(payload.passcode, "WB-1111-1111-1111-1111");
});
