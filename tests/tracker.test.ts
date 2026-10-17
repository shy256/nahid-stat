import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { SDK_PATH, VERSION } from "../src/version";

const source = await Bun.file(new URL(`../public/sdk/${VERSION}.js`, import.meta.url)).text();
function browser(options: { dnt?: string; gpc?: boolean; auto?: string; url?: string; site?: string; storage?: Map<string, string>; blockedStorage?: boolean; blockedWrite?: boolean; fetch?: (init: RequestInit) => Promise<Response> } = {}) {
  const listeners: Record<string, Function[]> = {};
  const sent: any[] = [], beacons: any[] = [];
  let url = new URL(options.url || "https://blog.example.com/start?token=private&utm_source=newsletter");
  const location = { get href() { return url.href; }, get pathname() { return url.pathname; }, get search() { return url.search; } };
  const storage = options.storage || new Map<string, string>();
  const localStorage = {
    getItem(key: string) { if (options.blockedStorage) throw new Error("blocked"); return storage.get(key) ?? null; },
    setItem(key: string, value: string) { if (options.blockedStorage || options.blockedWrite) throw new Error("blocked"); storage.set(key, value); },
    removeItem(key: string) { if (options.blockedStorage || options.blockedWrite) throw new Error("blocked"); storage.delete(key); },
  };
  const window: any = { addEventListener: (name: string, fn: Function) => (listeners[name] ??= []).push(fn) };
  const document = {
    currentScript: { src: `https://stats.example.com${SDK_PATH}`, dataset: { site: options.site || "blog", auto: options.auto } },
    referrer: "https://search.example.com/?private=secret", visibilityState: "visible",
    addEventListener: (name: string, fn: Function) => (listeners[name] ??= []).push(fn),
  };
  let fail = false;
  const context = {
    window, document, location, localStorage, URL, URLSearchParams, Uint8Array, TextEncoder, crypto, AbortSignal,
    navigator: { doNotTrack: options.dnt, globalPrivacyControl: options.gpc, sendBeacon: (_: string, data: string) => { beacons.push(JSON.parse(data)); return true; } },
    history: { pushState: (_: unknown, __: unknown, path: string) => { url = new URL(path, url); }, replaceState: (_: unknown, __: unknown, path: string) => { url = new URL(path, url); } },
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async (_: string, init: RequestInit) => { sent.push(JSON.parse(init.body as string)); return options.fetch ? options.fetch(init) : new Response(null, { status: fail ? 500 : 200 }); },
  };
  runInNewContext(source, context);
  return { window, document, context, storage, sent, beacons, listeners, fail: (value: boolean) => { fail = value; } };
}

test("链接标记在首次 PV 前生效，刷新、SPA、手动事件及 Beacon 均排除", async () => {
  const b = browser({ url: "https://blog.example.com/start?mazda_admin=1&mazda_site=blog&utm_source=newsletter#section" });
  expect(b.window.mazda.isAdmin).toBe(true);
  expect(b.context.location.href).toBe("https://blog.example.com/start?utm_source=newsletter#section");
  b.context.history.pushState({}, "", "/article");
  expect(b.window.mazda.page({ path: "/manual" })).toBe(false);
  expect(b.window.mazda.track("download")).toBe(false);
  await b.window.mazda.flush();
  b.document.visibilityState = "hidden";
  b.listeners.visibilitychange.forEach((fn) => fn());
  b.listeners.pageshow.forEach((fn) => fn({ persisted: true }));
  expect(b.sent).toHaveLength(0);
  expect(b.beacons).toHaveLength(0);
  const reloaded = browser({ storage: b.storage });
  await reloaded.window.mazda.flush();
  expect(reloaded.window.mazda.isAdmin).toBe(true);
  expect(reloaded.sent).toHaveLength(0);
});

test("取消链接恢复首次 PV；标记按站点隔离且忽略无效或其他站点参数", async () => {
  const storage = new Map([["mazda:admin:blog", "1"]]);
  const b = browser({ storage, url: "https://blog.example.com/start?mazda_admin=0&mazda_site=blog" });
  await b.window.mazda.flush();
  expect(b.window.mazda.isAdmin).toBe(false);
  expect(b.sent[0].events).toHaveLength(1);
  expect(storage.has("mazda:admin:blog")).toBe(false);
  storage.set("mazda:admin:blog", "1");
  const other = browser({ storage, site: "other" });
  await other.window.mazda.flush();
  expect(other.sent).toHaveLength(1);
  for (const query of ["mazda_admin=yes", "mazda_admin=1&mazda_site=other", "mazda_admin=1&mazda_site="]) {
    const normal = browser({ url: "https://blog.example.com/?" + query });
    await normal.window.mazda.flush();
    expect(normal.window.mazda.isAdmin).toBe(false);
    expect(normal.sent).toHaveLength(1);
  }
});

test("运行时标记清空待发队列，取消后同路径可重新采集", async () => {
  const b = browser();
  b.window.mazda.track("download");
  expect(b.window.mazda.setAdmin(true)).toBe(true);
  await b.window.mazda.flush();
  expect(b.sent).toHaveLength(0);
  expect(b.window.mazda.setAdmin("false")).toBe(false);
  expect(b.window.mazda.isAdmin).toBe(true);
  expect(b.window.mazda.setAdmin(false)).toBe(true);
  expect(b.window.mazda.page()).toBe(true);
  await b.window.mazda.flush();
  expect(b.sent[0].events).toHaveLength(1);
});

test("跨标签页标记清空旧队列，取消后恢复采集", async () => {
  const storage = new Map<string, string>();
  const b = browser({ storage }), other = browser({ storage });
  other.window.mazda.setAdmin(true);
  b.listeners.storage.forEach((fn) => fn({ key: "mazda:admin:blog" }));
  b.document.visibilityState = "hidden";
  b.listeners.visibilitychange.forEach((fn) => fn());
  await b.window.mazda.flush();
  expect(b.sent).toHaveLength(0);
  expect(b.beacons).toHaveLength(0);
  other.window.mazda.setAdmin(false);
  b.listeners.storage.forEach((fn) => fn({ key: null }));
  expect(b.window.mazda.page()).toBe(true);
  await b.window.mazda.flush();
  expect(b.sent[0].events).toHaveLength(1);
});

test("存储被禁用或写入失败时标记仍在当前页面生效，普通访问正常", async () => {
  for (const failure of [{ blockedStorage: true }, { blockedWrite: true }]) {
    const b = browser({ ...failure, url: "https://blog.example.com/?mazda_admin=1" });
    expect(b.window.mazda.isAdmin).toBe(true);
    expect(b.window.mazda.setAdmin(true)).toBe(false);
    await b.window.mazda.flush();
    expect(b.sent).toHaveLength(0);
    b.window.mazda.setAdmin(false);
    b.window.mazda.page();
    await b.window.mazda.flush();
    expect(b.sent).toHaveLength(1);
    const normal = browser(failure);
    await normal.window.mazda.flush();
    expect(normal.sent).toHaveLength(1);
  }
});

test("请求在途中失败时，标记前的事件不会在取消标记后重试", async () => {
  let complete!: (value: Response) => void;
  const b = browser({ fetch: () => new Promise((resolve) => { complete = resolve; }) });
  const pending = b.window.mazda.flush();
  b.window.mazda.setAdmin(true);
  b.window.mazda.setAdmin(false);
  complete(new Response(null, { status: 500 }));
  await pending;
  await b.window.mazda.flush();
  expect(b.sent).toHaveLength(1);
});

test("首次采集、SPA 去重、业务事件和客户端清洗", async () => {
  const b = browser();
  await b.window.mazda.flush();
  expect(b.sent[0].events[0].path).toBe("/start");
  expect(b.sent[0].events[0].referrer_host).toBe("search.example.com");
  expect(b.sent[0].events[0].utm_source).toBe("newsletter");
  expect(JSON.stringify(b.sent)).not.toContain("private");
  b.context.history.pushState({}, "", "/article?secret=private");
  b.context.history.replaceState({}, "", "/article?secret=other");
  b.window.mazda.track("download", { file_type: "pdf", email: "someone@example.com" });
  await b.window.mazda.flush();
  expect(b.sent[1].events).toHaveLength(2);
  expect(b.sent[1].events[0].path).toBe("/article");
  expect(b.sent[1].events[1].props).toEqual({ file_type: "pdf" });
});

test("失败重试保留事件 ID，页面隐藏发送 Beacon", async () => {
  const b = browser();
  b.fail(true);
  await b.window.mazda.flush();
  b.fail(false);
  await b.window.mazda.flush();
  expect(b.sent[0].events[0].event_id).toBe(b.sent[1].events[0].event_id);
  b.window.mazda.track("download", { file_type: "pdf" });
  b.document.visibilityState = "hidden";
  b.listeners.visibilitychange.forEach((fn) => fn());
  expect(b.beacons[0].events[0].name).toBe("download");
  expect(b.beacons[0].events).toHaveLength(1);
});

test("DNT 关闭采集，手动路由模式不自动发送", async () => {
  expect(browser({ dnt: "1" }).window.mazda).toBeUndefined();
  expect(browser({ gpc: true }).window.mazda).toBeUndefined();
  const b = browser({ auto: "false" });
  await b.window.mazda.flush();
  expect(b.sent).toHaveLength(0);
  b.window.mazda.page({ path: "/manual?secret=hidden" });
  b.window.mazda.track("download", { file_type: "pdf" });
  await b.window.mazda.flush();
  expect(b.sent[0].events[0].path).toBe("/manual");
  expect(b.sent[0].events[1].path).toBe("/manual");
});

test("DNT / GPC 开启时仍保存主动标记，隐私设置关闭后继续排除", async () => {
  for (const privacy of [{ dnt: "1" }, { gpc: true }]) {
    const b = browser({ ...privacy, url: "https://blog.example.com/?mazda_admin=1" });
    expect(b.window.mazda).toBeUndefined();
    const next = browser({ storage: b.storage });
    await next.window.mazda.flush();
    expect(next.window.mazda.isAdmin).toBe(true);
    expect(next.sent).toHaveLength(0);
  }
});

test("长路径批量事件按字节拆分，不超过接收接口限制", async () => {
  const b = browser({ auto: "false" });
  for (let i = 0; i < 20; i++) b.window.mazda.page({ path: "/" + "a".repeat(2000) + i });
  await b.window.mazda.flush();
  await b.window.mazda.flush();
  expect(b.sent).toHaveLength(2);
  expect(b.sent.flatMap((batch) => batch.events)).toHaveLength(20);
  for (const batch of b.sent) expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThan(32768);
});
