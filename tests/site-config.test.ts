import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { validateSites, type Config } from "../src/config";
import { createStore } from "../src/database";
import { MAX_SITE_CONFIG_BODY } from "../src/site-config";

const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
const site = { id: "blog", name: "博客", origins: ["https://blog.example.com"], timezone: "Asia/Shanghai", events: { download: ["file_type"] }, redactPaths: ["^/users/[^/]+"] };
async function setup(initial = [site]) {
  const dir = mkdtempSync(join(tmpdir(), "mazda-sites-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const config: Config = {
    host: "127.0.0.1", port: 3000, adminToken: randomBytes(32).toString("hex"),
    databasePath: ":memory:", retentionDays: 30, enableDemo: false,
    sitesPath: join(dir, "sites.json"), sites: validateSites(initial),
  };
  await Bun.write(config.sitesPath!, JSON.stringify(initial));
  const store = createStore(":memory:");
  cleanup.push(() => store.close());
  const app = createApp(config, store);
  const request = (method = "GET", body?: unknown, version?: string | null, authenticated = true) => app(new Request("http://localhost/admin/api/sites", {
    method, headers: {
      ...(authenticated ? { Authorization: `Bearer ${config.adminToken}` } : {}),
      ...(version ? { "If-Match": version } : {}), "Content-Type": "application/json",
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const version = (await request()).headers.get("ETag")!;
  return { dir, config, store, app, request, version };
}
function collect(origin: string, overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/collect", { method: "POST", headers: { Origin: origin }, body: JSON.stringify({ site_id: "blog", events: [{ v: 1, event_id: crypto.randomUUID(), type: "pageview", path: "/", ...overrides }] }) });
}

test("配置保存须鉴权、匹配版本且通过校验，失败保留原文件", async () => {
  const { request, version, config } = await setup();
  const original = await Bun.file(config.sitesPath!).text();
  expect((await request("PUT", [], version, false)).status).toBe(401);
  expect((await request("PUT", [])).status).toBe(428);
  expect((await request("PUT", [], '"outdated"')).status).toBe(409);
  for (const patch of [{ origins: [42] }, { origins: ["https://blog.example.com/"] }, { timezone: "" }, { timezone: "Unknown/Zone" }, { redactPaths: ["["] }, { events: { download: "any" } }]) {
    const response = await request("PUT", [{ ...site, ...patch }], version);
    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
  }
  expect((await request("PUT", [site, site], version)).status).toBe(400);
  expect(await Bun.file(config.sitesPath!).text()).toBe(original);
});

test("新增、修改、移除即时影响采集并落盘，重新加载仍保留", async () => {
  const { request, version, config, app, store } = await setup([]);
  const created = await request("PUT", [site], version);
  expect(created.status).toBe(200);
  expect((await app(collect(site.origins[0]))).status).toBe(200);
  const changed = { ...site, name: "新名称", origins: ["https://new.example.com"], timezone: "UTC", events: { subscribe: [] }, redactPaths: ["^/private/[^/]+"] };
  const updated = await request("PUT", [changed], created.headers.get("ETag"));
  expect(updated.status).toBe(200);
  expect((await app(collect(site.origins[0]))).status).toBe(403);
  expect((await app(collect(changed.origins[0], { type: "event", name: "download" }))).status).toBe(400);
  expect((await app(collect(changed.origins[0], { type: "event", name: "subscribe", path: "/private/alice/file" }))).status).toBe(200);
  expect(store.db.query<{ path: string }, []>("SELECT path FROM events WHERE type = 'event'").get()!.path).toBe("/[redacted]/file");
  expect(validateSites(await Bun.file(config.sitesPath!).json())).toEqual([changed]);
  const restarted = createApp({ ...config, sites: validateSites(await Bun.file(config.sitesPath!).json()) }, store);
  expect((await restarted(collect(changed.origins[0]))).status).toBe(200);
  expect((await request("PUT", [], updated.headers.get("ETag"))).status).toBe(200);
  expect((await app(collect(changed.origins[0]))).status).toBe(403);
  expect(await (await request()).json()).toEqual([]);
  expect(await Bun.file(config.sitesPath!).json()).toEqual([]);
  expect(store.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM events").get()!.count).toBe(3);
});

test("同版本的并发保存只有一次成功，旧页面不能覆盖新配置", async () => {
  const { request, version, config, dir } = await setup();
  const responses = await Promise.all([
    request("PUT", [{ ...site, name: "第一个" }], version),
    request("PUT", [{ ...site, name: "第二个" }], version),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(config.sites[0].name).toBe("第一个");
  expect((await Bun.file(config.sitesPath!).json())[0].name).toBe("第一个");
  expect(readdirSync(dir)).toEqual(["sites.json"]);
});

test("写盘失败不切换配置，之后可继续保存且不遗留临时文件", async () => {
  const { request, version, config, dir } = await setup();
  const originalPath = config.sitesPath!;
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "file");
  config.sitesPath = join(blocker, "sites.json");
  expect((await request("PUT", [], version)).status).toBe(500);
  expect(config.sites).toEqual([site]);
  expect(await Bun.file(originalPath).json()).toEqual([site]);
  config.sitesPath = originalPath;
  expect((await request("PUT", [], version)).status).toBe(200);
  expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("文件被手工修改时拒绝覆盖", async () => {
  const { request, version, config } = await setup();
  const external = [{ ...site, name: "文件编辑" }];
  await Bun.write(config.sitesPath!, JSON.stringify(external));
  expect((await request("PUT", [], version)).status).toBe(409);
  expect(await Bun.file(config.sitesPath!).json()).toEqual(external);
  expect(config.sites).toEqual([site]);
});

test("配置读取不返回未知字段；采集仍限制 32 KiB，管理配置独立限额", async () => {
  const { request, version, app, config } = await setup();
  const response = await request("PUT", [{ ...site, unknown: "ignored" }], version);
  expect(await response.json()).toEqual([site]);
  const large = new Request("http://localhost/admin/api/sites", { method: "PUT", headers: { "Content-Length": String(MAX_SITE_CONFIG_BODY + 1) }, body: "[]" });
  expect((await app(large)).status).toBe(401);
  large.headers.set("Authorization", `Bearer ${config.adminToken}`);
  expect((await app(large)).status).toBe(413);
  const streamed = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_SITE_CONFIG_BODY + 1)); controller.close(); } });
  expect((await app(new Request("http://localhost/admin/api/sites", { method: "PUT", headers: { Authorization: `Bearer ${config.adminToken}` }, body: streamed }))).status).toBe(413);
  const collectRequest = collect(site.origins[0], { props: { padding: "x".repeat(33000) } });
  expect((await app(collectRequest)).status).toBe(413);
});

test("缺少文件时可由管理接口创建", async () => {
  const { request, version, config, dir } = await setup([]);
  config.sitesPath = join(dir, "nested", "sites.json");
  expect((await request("PUT", [site], version)).status).toBe(200);
  expect(await Bun.file(config.sitesPath).json()).toEqual([site]);
});

test("加载配置支持空站点和缺少文件，默认使用本地 sites.json", async () => {
  const { config, dir } = await setup([]);
  const modulePath = new URL("../src/config.ts", import.meta.url).href;
  const source = `import { loadConfig } from ${JSON.stringify(modulePath)}; const config = await loadConfig(); console.log(JSON.stringify({ sites: config.sites, sitesPath: config.sitesPath }));`;
  const run = (path?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ADMIN_TOKEN: config.adminToken };
    delete env.SITE_CONFIG;
    if (path) env.SITE_CONFIG = path;
    const result = Bun.spawnSync([process.execPath, "-e", source], { cwd: dir, env });
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout.toString());
  };
  expect(run()).toEqual({ sites: [], sitesPath: "sites.json" });
  expect(run(join(dir, "new-sites.json"))).toEqual({ sites: [], sitesPath: join(dir, "new-sites.json") });
  await Bun.write(config.sitesPath!, JSON.stringify([site]));
  expect(run().sites).toEqual([site]);
});
