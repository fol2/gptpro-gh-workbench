#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "https://gptpro-gh-workbench.eugnel.uk";
const DEFAULT_REPO = "fol2/ks2-mastery";
const DEFAULT_TOKEN_FILE = path.join(homedir(), ".config", "gptpro-gh-workbench", "session-token");
const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_SESSION_TTL_SECONDS = 18_000;
const DEFAULT_MAX_REQUESTS = 500;
const DEFAULT_GET_READ_TIER = "standard";
const GET_READ_TIERS = new Set(["standard", "single"]);

const USAGE = `Usage:
  npm run passcode -- <repo>
  npm run passcode -- fol2/ks2-mastery
  npm run get-passcode -- fol2/private-repo --tier standard
  npm run get-passcode -- fol2/private-repo --tier single
  npm run passcode -- fol2/gptpro-gh-workbench --read-only
  npm run passcode -- fol2/ks2-mastery --merge --max-requests 10

Options:
  --repo <owner/name>             Repository to bind the action session to.
  --base-url <url>                Workbench URL. Defaults to ${DEFAULT_BASE_URL}.
  --token-file <path>             Session token file. Defaults to ${DEFAULT_TOKEN_FILE}.
  --ttl-seconds <seconds>         One-time passcode lifetime. Defaults to ${DEFAULT_TTL_SECONDS}.
  --session-ttl-seconds <seconds> Action session lifetime after exchange. Defaults to ${DEFAULT_SESSION_TTL_SECONDS} (300 minutes).
  --max-requests <count>          Action session request limit. Defaults to ${DEFAULT_MAX_REQUESTS}.
  --get-only                      Create a GET read passcode. No exchange step; use as ?readPasscode=...
  --tier <standard|single>        GET read tier. Defaults to standard: 10 reads/600 minutes. single is 1 read/10 minutes.
  --read-only                     Create a read-only action session.
  --write                         Create a write-capable action session. This is the default.
  --merge                         Also grant merge scope. Use only for an explicit merge task.
  --json                          Print the full broker response as JSON.
  --help                          Show this help.
`;

export function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    repo: null,
    tokenFile: DEFAULT_TOKEN_FILE,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
    maxRequests: null,
    customTtlSeconds: false,
    customMaxRequests: false,
    getOnly: false,
    tier: null,
    write: true,
    merge: false,
    json: false,
    help: false
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--read-only") {
      options.write = false;
      options.merge = false;
      continue;
    }

    if (arg === "--get-only") {
      options.getOnly = true;
      options.write = false;
      options.merge = false;
      continue;
    }

    if (arg === "--tier") {
      options.tier = requiredValue(args, arg);
      continue;
    }

    if (arg === "--write") {
      options.write = true;
      continue;
    }

    if (arg === "--merge") {
      options.write = true;
      options.merge = true;
      continue;
    }

    if (arg === "--repo") {
      options.repo = requiredValue(args, arg);
      continue;
    }

    if (arg === "--base-url") {
      options.baseUrl = requiredValue(args, arg);
      continue;
    }

    if (arg === "--token-file") {
      options.tokenFile = requiredValue(args, arg);
      continue;
    }

    if (arg === "--ttl-seconds") {
      options.ttlSeconds = parsePositiveInteger(requiredValue(args, arg), arg);
      options.customTtlSeconds = true;
      continue;
    }

    if (arg === "--session-ttl-seconds") {
      options.sessionTtlSeconds = parsePositiveInteger(requiredValue(args, arg), arg);
      continue;
    }

    if (arg === "--max-requests") {
      options.maxRequests = parsePositiveInteger(requiredValue(args, arg), arg);
      options.customMaxRequests = true;
      continue;
    }

    if (arg?.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.repo) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    options.repo = arg;
  }

  options.repo ||= DEFAULT_REPO;
  if (options.getOnly) {
    if (options.customMaxRequests || options.customTtlSeconds) {
      throw new Error("GET read passcodes use --tier standard or --tier single instead of --max-requests or --ttl-seconds.");
    }
    options.tier ||= DEFAULT_GET_READ_TIER;
    if (!GET_READ_TIERS.has(options.tier)) {
      throw new Error("--tier must be standard or single.");
    }
  } else {
    if (options.tier) {
      throw new Error("--tier is only available with --get-only.");
    }
    options.maxRequests ??= DEFAULT_MAX_REQUESTS;
  }
  delete options.customTtlSeconds;
  delete options.customMaxRequests;
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

export async function createActionPasscode(options, fetchImpl = fetch) {
  const token = await readSessionToken(options.tokenFile);
  const endpoint = options.getOnly ? "/api/action/read-passcodes" : "/api/action/passcodes";
  const requestBody = options.getOnly
    ? {
      repo: options.repo,
      tier: options.tier
    }
    : {
      repo: options.repo,
      write: options.write,
      merge: options.merge,
      ttlSeconds: options.ttlSeconds,
      sessionTtlSeconds: options.sessionTtlSeconds,
      maxRequests: options.maxRequests
    };

  const response = await fetchImpl(`${options.baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workbench-Session": token
    },
    body: JSON.stringify(requestBody)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.passcode) {
    const error = payload?.error ? `${payload.error}: ${payload.message || "request failed"}` : `HTTP ${response.status}`;
    throw new Error(`Could not create passcode (${error}).`);
  }

  return payload;
}

async function readSessionToken(tokenFile) {
  const token = (await readFile(tokenFile, "utf8")).trim();
  if (!token) {
    throw new Error(`Session token file is empty: ${tokenFile}`);
  }
  return token;
}

function requiredValue(args, option) {
  const value = args.shift();
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const payload = await createActionPasscode(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${payload.passcode}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
