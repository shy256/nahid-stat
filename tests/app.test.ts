import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { createApp } from "../src/app";
import { validateSites, type Config } from "../src/config";
import { createStore, type Store } from "../src/database";
import { dateRange, siteDay } from "../src/events";
import { SDK_PATH, VERSION } from "../src/version";

const now = Date.parse("2026-10-16T16:30:00Z");
const origin = "https://blog.example.com";
const stores: Store[] = [];
const config: Config = {
  host: "127.0.0.1", port: 3000, adminToken: randomBytes(32).toString("hex"),
  databasePath: ":memory:", retentionDays: 30, enableDemo: false,
  sites: validateSites([
    { id: "blog", name: "博客", origins: [origin], timezone: "Asia/Shanghai", events: { download: ["file_type"] }, redactPaths: ["^/users/[^/]+"] },
    { id: "other", name: "其他站点", origins: ["https://other.example.com"], timezone: "UTC", events: {} },
  ]),
};
function setup(path = ":memory:") {
  const store = createStore(path);
  stores.push(store);
  return { store, app: createApp(config, store, () => now) };
}
afterEach(() => { while (stores.length) stores.pop()!.close(); });
function event(overrides: Record<string, unknown> = {}) {
  return { v: 1, event_id: crypto.randomUUID(), type: "pageview", path: "/posts/bun?token=secret#email", referrer_host: "www.google.com", ...overrides };
}
function collect(events: unknown[], site = "blog", requestOrigin = origin) {
  return new Request("http://localhost/api/collect", {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0 (iPhone; Mobile)" },
    body: JSON.stringify({ site_id: site, events }),
  });
}
function admin(path: string, token = config.adminToken) {
  return new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

describe("采集与统计", () => {
  test("站点标记所需的 origins 仅通过鉴权管理接口返回", async () => {
    const { app } = setup();
    expect((await app(new Request("http://localhost/admin/api/sites"))).status).toBe(401);
    const sites = await (await app(admin("/admin/api/sites"))).json();
    expect(sites[0]).toEqual(config.sites[0]);
    expect(JSON.stringify(sites)).not.toContain(config.adminToken);
  });
  test("去重、来源、设备、查询参数清洗和站点时区", async () => {
    const { app, store } = setup();
    const item = event();
    expect(await (await app(collect([item, item]))).json()).toEqual({ accepted: 1, duplicates: 1 });
    expect(await (await app(collect([item]))).json()).toEqual({ accepted: 0, duplicates: 1 });
    const stats = await (await app(admin("/admin/api/stats?site_id=blog&days=7"))).json();
    expect(stats.totals).toEqual({ pageviews: 1, events: 0 });
    expect(stats.range.to).toBe("2026-10-17");
    expect(stats.trend).toHaveLength(7);
    expect(stats.trend.at(-1).pageviews).toBe(1);
    expect(stats.pages).toEqual([{ value: "/posts/bun", count: 1 }]);
    expect(stats.sources).toEqual([{ value: "www.google.com", count: 1 }]);
    expect(stats.devices).toEqual([{ value: "mobile", count: 1 }]);
    const row = store.db.query("SELECT * FROM events").get()!;
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(Object.keys(row)).not.toContain("ip");
    expect(Object.keys(row)).not.toContain("user_agent");
  });

  test("站内来源归为直接访问，推广来源优先", async () => {
    const { app } = setup();
    await app(collect([event({ referrer_host: "blog.example.com" }), event({ utm_source: "newsletter" })]));
    const stats = await (await app(admin("/admin/api/stats?site_id=blog&days=1"))).json();
    expect(stats.sources).toEqual([{ value: "(direct)", count: 1 }, { value: "newsletter", count: 1 }]);
  });

  test("自定义事件属性只保存白名单，敏感路径脱敏", async () => {
    const { app, store } = setup();
    const response = await app(collect([event({ type: "event", name: "download", path: "/users/alice/file", props: { file_type: "pdf", email: "private@example.com" } })]));
    expect(response.status).toBe(200);
    const row = store.db.query<{ props: string; path: string }, []>("SELECT props, path FROM events").get()!;
    expect(JSON.parse(row.props)).toEqual({ file_type: "pdf" });
    expect(row.path).toBe("/[redacted]/file");
    const stats = await (await app(admin("/admin/api/stats?site_id=blog&days=1"))).json();
    expect(stats.totals).toEqual({ pageviews: 0, events: 1 });
    expect(stats.events).toEqual([{ value: "download", count: 1 }]);
  });

  test("无效批次不产生部分写入，数据库失败回滚明细与汇总", async () => {
    const { app, store } = setup();
    expect((await app(collect([event(), event({ name: "unknown", type: "event" })]))).status).toBe(400);
    expect(store.db.query("SELECT * FROM events").all()).toHaveLength(0);
    store.db.exec("CREATE TRIGGER fail_count BEFORE INSERT ON daily_counts BEGIN SELECT RAISE(ABORT, 'test'); END");
    expect((await app(collect([event()]))).status).toBe(500);
    expect(store.db.query("SELECT * FROM events").all()).toHaveLength(0);
  });

  test("清理只删除明细，保留日汇总", async () => {
    const { app, store } = setup();
    await app(collect([event()]));
    expect(store.cleanup(now + 31 * 86_400_000, 30)).toBe(1);
    expect(store.db.query("SELECT * FROM events").all()).toHaveLength(0);
    expect(store.stats(config.sites[0], 1, now).totals.pageviews).toBe(1);
  });

  test("落盘后重新打开仍能查询", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mazda-test-"));
    const path = join(dir, "test.sqlite");
    let store = createStore(path);
    try {
      await createApp(config, store, () => now)(collect([event()]));
      store.close();
      store = createStore(path);
      expect(store.stats(config.sites[0], 1, now).totals.pageviews).toBe(1);
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  });

  test("备份命令包含 WAL 中的已提交数据，拒绝覆盖已有备份", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mazda-backup-"));
    const source = join(dir, "source.sqlite"), target = join(dir, "snapshot.sqlite");
    const store = createStore(source);
    try {
      await createApp(config, store, () => now)(collect([event()]));
      const args = [process.execPath, fileURLToPath(new URL("../scripts/backup.ts", import.meta.url)), target];
      const result = Bun.spawnSync(args, { env: { ...process.env, DATABASE_PATH: source } });
      expect(result.exitCode).toBe(0);
      const restored = new Database(target, { readonly: true });
      try {
        expect(restored.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM events").get()!.count).toBe(1);
        expect(restored.query<{ count: number }, []>("SELECT count FROM daily_counts WHERE dimension = 'total'").get()!.count).toBe(1);
      } finally { restored.close(true); }
      expect(Bun.spawnSync(args, { env: { ...process.env, DATABASE_PATH: source } }).exitCode).not.toBe(0);
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  });
});

describe("接口边界", () => {
  test("管理面仅在 /admin 下提供，旧地址与相似前缀不暴露管理功能", async () => {
    const { app, store } = setup();
    for (const path of ["/admin/demo", "/admin/demo.js"]) {
      expect((await app(new Request(`http://localhost${path}`))).status).toBe(404);
    }
    const withDemo = createApp({ ...config, enableDemo: true }, store, () => now);
    for (const [path, contentType] of [
      ["/admin", "text/html"], ["/admin/", "text/html"],
      ["/admin/dashboard.js", "text/javascript"], ["/admin/style.css", "text/css"],
      ["/admin/demo", "text/html"], ["/admin/demo.js", "text/javascript"],
    ]) {
      const response = await withDemo(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain(contentType!);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    for (const path of ["/", "/dashboard.js", "/style.css", "/demo", "/demo.js", "/api/sites", "/api/stats?site_id=blog", "/administrator", "/admin-api/sites"]) {
      expect((await withDemo(new Request(`http://localhost${path}`))).status).toBe(404);
      expect((await withDemo(admin(path))).status).toBe(404);
    }
    const demo = await (await withDemo(new Request("http://localhost/admin/demo"))).text();
    expect(demo).toContain(`src="${SDK_PATH}"`);
    expect(demo).not.toContain("__MAZDA_SDK_PATH__");
    for (const path of ["/admin/api/sites", "/admin/api/stats?site_id=blog"]) {
      expect((await app(new Request(`http://localhost${path}`))).status).toBe(401);
      expect((await app(admin(path, "wrong"))).status).toBe(401);
    }
    const tracker = await app(new Request("http://localhost/tracker.js"));
    expect(tracker.status).toBe(302);
    expect(tracker.headers.get("Location")).toBe(SDK_PATH);
    expect(tracker.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(tracker.headers.get("Cache-Control")).toBe("no-store");
    expect(await (await app(new Request("http://localhost/health"))).json()).toEqual({ status: "ok", version: VERSION });
  });

  test("管理接口鉴权，采集站点来源隔离，CORS 正确", async () => {
    const { app } = setup();
    expect((await app(admin("/admin/api/sites", "wrong"))).status).toBe(401);
    expect((await app(admin("/admin/api/sites"))).status).toBe(200);
    expect((await app(collect([event()], "blog", "https://evil.example.com"))).status).toBe(403);
    expect((await app(collect([event()], "other", origin))).status).toBe(403);
    const response = await app(collect([event()]));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect((await app(admin("/admin/api/stats?site_id=other"))).headers.get("Access-Control-Allow-Origin")).toBeNull();
    const preflight = await app(new Request("http://localhost/api/collect", { method: "OPTIONS", headers: { Origin: origin } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  test("非法路径、超大请求、无效 JSON 与批次数限制", async () => {
    const { app } = setup();
    for (const path of ["//evil.example/x", "/\\evil", "/bad%ZZ"]) {
      expect((await app(collect([event({ path })]))).status).toBe(400);
    }
    expect((await app(collect(Array.from({ length: 21 }, () => event())))).status).toBe(400);
    expect((await app(new Request("http://localhost/api/collect", { method: "POST", headers: { Origin: origin }, body: "{" }))).status).toBe(400);
    const oversized = new Request("http://localhost/api/collect", { method: "POST", headers: { Origin: origin }, body: "x".repeat(33000) });
    expect((await app(oversized)).status).toBe(413);
    const streamed = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(33000)); controller.close(); } });
    expect((await app(new Request("http://localhost/api/collect", { method: "POST", headers: { Origin: origin }, body: streamed }))).status).toBe(413);
  });

  test("按连接来源限流，不信任转发头", async () => {
    const { app } = setup();
    for (let i = 0; i < 120; i++) expect((await app(collect([event()]), "same-peer")).status).toBe(200);
    const request = collect([event()]);
    request.headers.set("X-Forwarded-For", "different");
    const response = await app(request, "same-peer");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect((await app(collect([event()]), "another-peer")).status).toBe(200);
  });

  test("已知机器人过滤、统计范围校验、示例页面默认关闭", async () => {
    const { app, store } = setup();
    const request = collect([event()]);
    request.headers.set("User-Agent", "Googlebot/2.1");
    expect((await (await app(request)).json()).filtered).toBe(true);
    expect(store.stats(config.sites[0], 1, now).totals.pageviews).toBe(0);
    expect((await app(admin("/admin/api/stats?site_id=blog&days=999"))).status).toBe(400);
    expect((await app(admin("/admin/api/stats?site_id=missing"))).status).toBe(404);
    expect((await app(new Request("http://localhost/admin/demo"))).status).toBe(404);
    const tracker = await app(new Request(`http://localhost${SDK_PATH}`));
    expect(tracker.headers.get("Content-Type")).toContain("javascript");
    expect(await tracker.text()).toContain("window.mazda");
  });

  test("真实 HTTP 服务可加载管理页面及引用资源、接收公开上报并鉴权查询", async () => {
    const { app } = setup();
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => app(req) });
    try {
      for (const path of ["/admin", "/admin/"]) {
        const page = await fetch(new URL(path, server.url));
        expect(page.status).toBe(200);
        const html = await page.text();
        const resources = Array.from(html.matchAll(/(?:src|href)="(\/[^\"]+)"/g), (match) => match[1]!);
        expect(resources).toContain("/admin/dashboard.js");
        expect(resources).toContain("/admin/style.css");
        for (const resource of resources) {
          expect(resource === "/admin" || resource.startsWith("/admin/")).toBe(true);
          expect((await fetch(new URL(resource, server.url))).status).toBe(200);
        }
      }
      for (const path of ["/mazda", "/tracker.js"]) {
        const redirect = await fetch(new URL(`${path}?test=1`, server.url), { redirect: "manual" });
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get("Location")).toBe(`${SDK_PATH}?test=1`);
        const sdk = await fetch(new URL(path, server.url));
        expect(sdk.status).toBe(200);
        expect(new URL(sdk.url).pathname).toBe(SDK_PATH);
        expect(sdk.headers.get("Content-Type")).toContain("javascript");
        expect(await sdk.text()).toBe(await Bun.file(new URL("../public/tracker.js", import.meta.url)).text());
      }
      const dashboard = await (await fetch(new URL("/admin/dashboard.js", server.url))).text();
      expect(dashboard).toContain(`new URL("${SDK_PATH}", location.href)`);
      expect(dashboard).not.toContain("__MAZDA_SDK_PATH__");
      expect((await fetch(new URL("/mazda@999.0.0", server.url))).status).toBe(404);
      const response = await fetch(new URL("/api/collect", server.url), {
        method: "POST", headers: { Origin: origin }, body: JSON.stringify({ site_id: "blog", events: [event()] }),
      });
      expect((await response.json()).accepted).toBe(1);
      const stats = await fetch(new URL("/admin/api/stats?site_id=blog&days=1", server.url), { headers: { Authorization: `Bearer ${config.adminToken}` } });
      expect((await stats.json()).totals.pageviews).toBe(1);
    } finally { await server.stop(true); }
  });
});

test("站点配置验证与跨月、夏令时时间范围", () => {
  expect(() => validateSites([{ name: "missing id", origins: [origin], timezone: "UTC" }])).toThrow();
  expect(() => validateSites([{ id: "x", name: "x", origins: [origin + "/"], timezone: "UTC" }])).toThrow();
  expect(() => validateSites([{ id: "x", name: "x", origins: [origin], timezone: "Unknown/Zone" }])).toThrow();
  expect(siteDay(Date.parse("2026-03-08T07:01:00Z"), "America/New_York")).toBe("2026-03-08");
  expect(dateRange("2026-03-01", 3)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
});
