import { expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdminAuth } from "../src/auth";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { createStore } from "../src/database";

function config(): Config {
  return {
    host: "127.0.0.1", port: 3000, adminToken: randomBytes(32).toString("hex"),
    wsAuthUidSecret: randomBytes(32).toString("hex"), databasePath: ":memory:",
    retentionDays: 30, enableDemo: false, sites: [],
  };
}
function signedHeaders(secret: string, uid = "gateway-user") {
  return { "x-ws-uid": uid, "x-ws-uid-sig": createHmac("sha256", secret).update(uid, "utf8").digest("hex") };
}
const request = (headers: HeadersInit = {}) => new Request("http://localhost/admin/api/sites", { headers });

test("OSG UID 仅接受来自本机连接且匹配共享密钥的 HMAC-SHA256 签名", () => {
  const options = config();
  const authorize = createAdminAuth(options);
  const headers = signedHeaders(options.wsAuthUidSecret!);
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(authorize(request(headers), ip)).toBe(true);
  for (const ip of ["unknown", "192.0.2.1", "127.0.0.2", "::ffff:192.0.2.1"]) {
    expect(authorize(request({ ...headers, "X-Forwarded-For": "127.0.0.1" }), ip)).toBe(false);
  }
  const invalidHeaders: HeadersInit[] = [
    {}, { "x-ws-uid": "gateway-user" }, { "x-ws-uid-sig": headers["x-ws-uid-sig"] },
    { ...headers, "x-ws-uid": "attacker" }, signedHeaders("another-secret"),
    { ...headers, "x-ws-uid-sig": "a".repeat(63) },
    { ...headers, "x-ws-uid-sig": "z".repeat(64) },
    { ...headers, "x-ws-uid-sig": headers["x-ws-uid-sig"].toUpperCase() },
    signedHeaders(options.wsAuthUidSecret!, "user,other"),
    signedHeaders(options.wsAuthUidSecret!, "a".repeat(257)),
  ];
  for (const forged of invalidHeaders) expect(authorize(request(forged), "127.0.0.1")).toBe(false);
  expect(createAdminAuth({ ...options, wsAuthUidSecret: undefined })(request(headers), "127.0.0.1")).toBe(false);
  expect(authorize(request({ Authorization: `Bearer ${options.adminToken}` }), "192.0.2.1")).toBe(true);
});

test("网关签名通过真实 HTTP 读写管理配置，版本冲突与落盘重启约束保持有效", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mazda-auth-"));
  const options = { ...config(), sitesPath: join(dir, "sites.json") };
  const store = createStore(":memory:");
  const handle = createApp(options, store);
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req, server) { return handle(req, server.requestIP(req)?.address ?? "unknown"); },
  });
  try {
    const url = new URL("/admin/api/sites", server.url);
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { "x-ws-uid": "attacker" } })).status).toBe(401);
    const headers = signedHeaders(options.wsAuthUidSecret!);
    const initial = await fetch(url, { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual([]);
    const sites = [{ id: "blog", name: "博客", origins: ["https://example.com"], timezone: "UTC", events: {}, redactPaths: [] }];
    const put = (etag?: string) => fetch(url, { method: "PUT", headers: {
      ...headers, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}),
    }, body: JSON.stringify(sites) });
    expect((await put()).status).toBe(428);
    const saved = await put(initial.headers.get("ETag")!);
    expect(saved.status).toBe(200);
    expect((await put(initial.headers.get("ETag")!)).status).toBe(409);
    expect(JSON.parse(readFileSync(options.sitesPath, "utf8"))).toEqual(sites);
    const child = Bun.spawn([process.execPath, "-e", `import {loadConfig} from ${JSON.stringify(new URL("../src/config.ts", import.meta.url).href)}; const config=await loadConfig(); console.log(JSON.stringify({sites:config.sites,enabled:!!config.wsAuthUidSecret}));`], {
      env: { ...process.env, ADMIN_TOKEN: options.adminToken, WS_AUTH_UID_SECRET: options.wsAuthUidSecret!, SITE_CONFIG: options.sitesPath },
      stdout: "pipe", stderr: "pipe",
    });
    const reloaded = JSON.parse(await new Response(child.stdout).text());
    expect(await child.exited).toBe(0);
    expect(reloaded).toEqual({ sites, enabled: true });
    expect((await fetch(new URL("/health", server.url))).status).toBe(200);
  } finally {
    await server.stop(true);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
