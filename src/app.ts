import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "./config";
import type { Store } from "./database";
import { HttpError, normalizeEvent } from "./events";
import { createSiteConfig, MAX_SITE_CONFIG_BODY } from "./site-config";
import { createSdkHandler } from "./sdk";
import { SDK_PATH, VERSION } from "./version";

const MAX_BODY = 32 * 1024;
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

async function readJson(req: Request, limit = MAX_BODY): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > limit) throw new HttpError(413, "请求过大");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "请求体不能为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, "请求过大"); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new HttpError(400, "JSON 格式无效"); }
}

export function createApp(config: Config, store: Store, now = () => Date.now()) {
  const siteConfig = createSiteConfig(config);
  const sdk = createSdkHandler();
  const tokenHash = createHash("sha256").update(config.adminToken).digest();
  const rateSecret = randomBytes(32);
  const buckets = new Map<string, { count: number; expires: number }>();
  const assets: Record<string, [string, string]> = {
    "/admin": ["dashboard.html", "text/html; charset=utf-8"],
    "/admin/": ["dashboard.html", "text/html; charset=utf-8"],
    "/admin/dashboard.js": ["dashboard.js", "text/javascript; charset=utf-8"],
    "/admin/style.css": ["style.css", "text/css; charset=utf-8"],
  };
  if (config.enableDemo) {
    assets["/admin/demo"] = ["demo.html", "text/html; charset=utf-8"];
    assets["/admin/demo.js"] = ["demo.js", "text/javascript; charset=utf-8"];
  }
  const bodyCache = new Map<string, Promise<string>>();
  for (const [file] of Object.values(assets)) {
    bodyCache.set(file, Bun.file(new URL(`../public/${file}`, import.meta.url)).text().then((body) =>
      file === "dashboard.js" || file === "demo.html" ? body.replaceAll("__MAZDA_SDK_PATH__", SDK_PATH) : body));
  }

  function limited(ip: string) {
    const time = now();
    const key = createHmac("sha256", rateSecret).update(ip).digest("hex");
    let bucket = buckets.get(key);
    if (!bucket || bucket.expires <= time) {
      for (const [key, value] of buckets) if (value.expires <= time) buckets.delete(key);
      if (buckets.size >= 10_000 && !buckets.has(key)) return true;
      bucket = { count: 0, expires: time + 60_000 };
      buckets.set(key, bucket);
    }
    return ++bucket.count > 120;
  }

  return async function handle(req: Request, ip = "unknown"): Promise<Response> {
    const headers = new Headers(securityHeaders);
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    try {
      const url = new URL(req.url);
      if (url.pathname === "/api/collect") {
        const origin = req.headers.get("origin");
        if (!origin || !config.sites.some((site) => site.origins.includes(origin))) {
          throw new HttpError(403, "来源未允许");
        }
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
        if (limited(ip)) { headers.set("Retry-After", "60"); throw new HttpError(429, "上报过于频繁"); }
        if (req.method === "OPTIONS") {
          headers.set("Access-Control-Allow-Methods", "POST");
          headers.set("Access-Control-Allow-Headers", "Content-Type");
          headers.set("Access-Control-Max-Age", "600");
          return new Response(null, { status: 204, headers });
        }
        if (req.method !== "POST") { headers.set("Allow", "POST, OPTIONS"); throw new HttpError(405, "方法不支持"); }
        const body = await readJson(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "批次格式无效");
        const batch = body as Record<string, unknown>;
        const site = config.sites.find((site) => site.id === batch.site_id);
        if (!site || !site.origins.includes(origin)) throw new HttpError(403, "站点与来源不匹配");
        if (!Array.isArray(batch.events) || !batch.events.length || batch.events.length > 20) {
          throw new HttpError(400, "每批必须包含 1–20 条事件");
        }
        const ua = req.headers.get("user-agent") ?? "";
        const events = batch.events.map((event) => normalizeEvent(event, site, ua));
        if (/bot\b|crawler|spider|slurp/i.test(ua)) return json({ accepted: 0, filtered: true });
        const accepted = store.ingest(site, events, now());
        return json({ accepted, duplicates: events.length - accepted });
      }
      if (url.pathname.startsWith("/admin/api/")) {
        const auth = req.headers.get("authorization") ?? "";
        const provided = createHash("sha256").update(auth.startsWith("Bearer ") ? auth.slice(7) : "").digest();
        if (!timingSafeEqual(provided, tokenHash)) throw new HttpError(401, "管理令牌无效");
        if (url.pathname === "/admin/api/sites") {
          if (req.method === "PUT") {
            await siteConfig.save(await readJson(req, MAX_SITE_CONFIG_BODY), req.headers.get("if-match"));
          } else if (req.method !== "GET") {
            headers.set("Allow", "GET, PUT");
            throw new HttpError(405, "方法不支持");
          }
          headers.set("ETag", siteConfig.version());
          return json(config.sites);
        }
        if (req.method !== "GET") { headers.set("Allow", "GET"); throw new HttpError(405, "方法不支持"); }
        if (url.pathname === "/admin/api/stats") {
          const site = config.sites.find((site) => site.id === url.searchParams.get("site_id"));
          if (!site) throw new HttpError(404, "站点不存在");
          const days = Number(url.searchParams.get("days") ?? 7);
          if (![1, 7, 30].includes(days)) throw new HttpError(400, "days 仅支持 1、7、30");
          return json(store.stats(site, days, now()));
        }
        throw new HttpError(404, "接口不存在");
      }
      const sdkResponse = sdk(req, url);
      if (sdkResponse) return sdkResponse;
      if (req.method !== "GET") { headers.set("Allow", "GET"); throw new HttpError(405, "方法不支持"); }
      if (url.pathname === "/health") return json({ status: "ok", version: VERSION });
      const asset = assets[url.pathname];
      if (!asset) throw new HttpError(404, "页面不存在");
      const [file, contentType] = asset;
      headers.set("Content-Type", contentType);
      return new Response(await bodyCache.get(file), { headers });
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // 不打印请求体、URL、请求头或数据库绑定参数。
      console.error("请求处理失败；请检查数据库状态和服务配置");
      return json({ error: "服务暂时不可用" }, 500);
    }
  };
}
