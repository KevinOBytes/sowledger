import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const execFileAsync = promisify(execFile);
const providerUrl = "https://isolated-rate-limit.invalid";
const providerToken = "local-test-token-not-a-credential";
let nextAddress = 30;

function request(ip: string) {
  return new NextRequest("https://sowledger.example/api/auth/request-link", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

async function withProvider(run: (ip: string) => Promise<void>, legacyNames = false) {
  const keys = ["VERCEL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  for (const key of keys) delete process.env[key];
  process.env.VERCEL = "1";
  process.env[legacyNames ? "KV_REST_API_URL" : "UPSTASH_REDIS_REST_URL"] = `${providerUrl}/`;
  process.env[legacyNames ? "KV_REST_API_TOKEN" : "UPSTASH_REDIS_REST_TOKEN"] = providerToken;
  try {
    await run(`192.0.2.${nextAddress++}`);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

type Call = { input: string; init: RequestInit | undefined };
function commandFrom(call: Call, ip: string) {
  assert.equal(call.input, providerUrl, "one atomic command goes to the REST root");
  assert.equal(call.init?.method, "POST");
  assert.equal(call.init?.cache, "no-store");
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${providerToken}`);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(typeof call.init?.body, "string");
  const command = JSON.parse(call.init?.body as string) as [string, string, number, string, number];
  assert.equal(command.length, 5);
  assert.equal(command[0], "EVAL");
  assert.equal(typeof command[1], "string");
  assert.ok(command[1].length > 0);
  assert.deepEqual(command.slice(2), [1, `sowledger:auth:ip:${ip}`, 300]);
  return command;
}

test("remote limiting sends one atomic command per request and preserves limits and security headers", async () => {
  await withProvider(async (ip) => {
    const calls: Call[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json({ result: calls.length });
    };
    for (let i = 1; i <= 8; i++) {
      assert.equal((await proxy(request(ip))).status, 200);
      assert.equal(calls.length, i, "increment and expiry must not use separate requests");
      commandFrom(calls.at(-1)!, ip);
    }
    const blocked = await proxy(request(ip));
    assert.equal(blocked.status, 429);
    assert.equal(calls.length, 9);
    assert.equal(blocked.headers.get("retry-after"), "300");
    assert.equal(blocked.headers.get("x-ratelimit-limit"), "8");
    assert.equal(blocked.headers.get("x-content-type-options"), "nosniff");
    assert.equal(blocked.headers.get("x-frame-options"), "DENY");
  });
});

test("legacy KV REST configuration uses the same atomic operation", async () => {
  await withProvider(async (ip) => {
    const calls: Call[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json({ result: 2 });
    };
    assert.equal((await proxy(request(ip))).status, 200);
    assert.equal(calls.length, 1);
    commandFrom(calls[0], ip);
  }, true);
});

test("invalid remote counts use the bounded local fallback instead of bypassing or blocking the first request", async () => {
  for (const result of [undefined, null, 0, -1, 1.5, "1", "not-a-number", Number.MAX_SAFE_INTEGER + 1]) {
    await withProvider(async (ip) => {
      globalThis.fetch = async () => Response.json({ result });
      for (let i = 0; i < 8; i++) assert.equal((await proxy(request(ip))).status, 200, `fallback for ${String(result)}`);
      assert.equal((await proxy(request(ip))).status, 429, `fallback remains bounded for ${String(result)}`);
    });
  }
});

test("provider failures retain the bounded fallback without leaking provider errors", async () => {
  const failures = [
    async () => new Response("unavailable", { status: 503 }),
    async () => Response.json({ error: "provider-only error" }),
    async () => Response.json({ result: 1, error: "provider-only error" }),
    async () => new Response("invalid JSON"),
    async () => { throw new Error("provider-only error"); },
  ];
  for (const failure of failures) {
    await withProvider(async (ip) => {
      globalThis.fetch = failure;
      for (let i = 0; i < 8; i++) assert.equal((await proxy(request(ip))).status, 200);
      const blocked = await proxy(request(ip));
      assert.equal(blocked.status, 429);
      assert.deepEqual(await blocked.json(), { error: "Too many requests. Please wait and try again." });
    });
  }
});

// This optional integration check executes the actual emitted Lua, not a JS
// reimplementation. It needs local Redis tools; no TCP listener, provider
// credentials, persistent files, or remote services are used.
const hasLocalRedis = spawnSync("redis-server", ["--version"]).status === 0 && spawnSync("redis-cli", ["--version"]).status === 0;
test("actual Redis keeps the original window, repairs orphan counters and expires counters after concurrent requests", {
  skip: hasLocalRedis ? false : "Install redis-server and redis-cli to exercise the real Lua command locally",
  timeout: 15000,
}, async () => {
  // macOS's default temporary directory can exceed Unix socket path limits.
  const directory = await mkdtemp("/tmp/sowledger-rate-limit-");
  const socket = path.join(directory, "redis.sock");
  const server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", directory], { stdio: ["ignore", "pipe", "pipe"] });
  let startupOutput = "";
  server.stdout.on("data", (chunk: Buffer) => { startupOutput += chunk.toString(); });
  server.stderr.on("data", (chunk: Buffer) => { startupOutput += chunk.toString(); });
  const stopped = once(server, "exit");
  const redis = async (...args: string[]) => (await execFileAsync("redis-cli", ["--raw", "-s", socket, ...args])).stdout.trim();
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await redis("PING")) === "PONG"; } catch { /* Socket is not ready yet. */ }
      if (ready) break;
      await delay(10);
    }
    assert.equal(ready, true, `isolated Redis socket starts: ${startupOutput}`);
    await withProvider(async (ip) => {
      let loseResponse = false;
      globalThis.fetch = async (input, init) => {
        const command = commandFrom({ input: String(input), init }, ip);
        const count = Number(await redis(...command.map(String)));
        if (loseResponse) { loseResponse = false; throw new Error("simulated lost response after execution"); }
        return Response.json({ result: count });
      };
      const key = `sowledger:auth:ip:${ip}`;
      assert.equal((await proxy(request(ip))).status, 200);
      assert.equal(await redis("GET", key), "1");
      assert.ok(Number(await redis("TTL", key)) > 0);

      await redis("EXPIRE", key, "120");
      assert.equal((await proxy(request(ip))).status, 200);
      assert.ok(Number(await redis("TTL", key)) <= 120, "subsequent hits do not extend the fixed window");

      await redis("PERSIST", key);
      assert.equal(await redis("TTL", key), "-1");
      loseResponse = true;
      assert.equal((await proxy(request(ip))).status, 200);
      assert.ok(Number(await redis("TTL", key)) > 0, "even a lost response repairs an old counter with no expiry");

      await redis("DEL", key);
      const responses = await Promise.all(Array.from({ length: 20 }, () => proxy(request(ip))));
      assert.equal(responses.filter((response) => response.status === 200).length, 8);
      assert.equal(responses.filter((response) => response.status === 429).length, 12);
      assert.equal(await redis("GET", key), "20");
      assert.ok(Number(await redis("TTL", key)) > 0);

      await redis("PEXPIRE", key, "1");
      await delay(10);
      assert.equal((await proxy(request(ip))).status, 200);
      assert.equal(await redis("GET", key), "1", "expired counters start a fresh allowance");
    });
  } finally {
    server.kill("SIGTERM");
    await stopped;
    await rm(directory, { recursive: true, force: true });
  }
});
