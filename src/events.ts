import type { Site } from "./config";

export interface AnalyticsEvent {
  id: string;
  type: "pageview" | "event";
  path: string;
  referrer: string;
  source: string;
  medium: string;
  campaign: string;
  device: "mobile" | "tablet" | "desktop" | "unknown";
  name: string;
  props: Record<string, string | number | boolean>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// 不把任意自由文本作为维度：限制字符集与长度，仍需站长避免在 URL 路径中放敏感信息。
function tag(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_. -]{1,64}$/.test(value) ? value : "";
}

function cleanPath(value: unknown, site: Site): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") ||
      value.startsWith("//") || /[\u0000-\u001f\\]/.test(value)) {
    throw new HttpError(400, "页面路径无效");
  }
  let path = new URL(value, "https://path.invalid").pathname;
  for (const pattern of site.redactPaths) path = path.replace(new RegExp(pattern, "g"), "/[redacted]");
  // 保守屏蔽邮箱及常见长令牌片段；业务路径仍应使用 redactPaths 显式配置。
  path = path.split("/").map((part) => {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw new HttpError(400, "路径编码无效"); }
    return /@/.test(decoded) || /^[a-zA-Z0-9_-]{40,}$/.test(decoded) ? "[redacted]" : part;
  }).join("/");
  return path || "/";
}

export function normalizeEvent(input: unknown, site: Site, userAgent: string): AnalyticsEvent {
  if (!record(input) || input.v !== 1 || typeof input.event_id !== "string" ||
      !/^[a-zA-Z0-9_-]{16,80}$/.test(input.event_id) ||
      (input.type !== "pageview" && input.type !== "event")) {
    throw new HttpError(400, "事件格式或协议版本无效");
  }
  let referrer = "";
  if (input.referrer_host !== undefined && input.referrer_host !== "") {
    if (typeof input.referrer_host !== "string" || input.referrer_host.length > 253 ||
        !/^[a-zA-Z0-9.-]+$/.test(input.referrer_host)) throw new HttpError(400, "来源域名无效");
    referrer = input.referrer_host.toLowerCase();
    if (site.origins.some((origin) => new URL(origin).hostname === referrer)) referrer = "";
  }
  let name = "";
  const props: AnalyticsEvent["props"] = {};
  if (input.type === "event") {
    if (typeof input.name !== "string" || !Object.hasOwn(site.events, input.name)) {
      throw new HttpError(400, "事件名称未配置");
    }
    name = input.name;
    if (input.props !== undefined && !record(input.props)) throw new HttpError(400, "事件属性无效");
    for (const key of site.events[name]) {
      const value = (input.props as Record<string, unknown> | undefined)?.[key];
      if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" && value.length <= 64 && /^[a-zA-Z0-9_. -]*$/.test(value))) {
        props[key] = value;
      }
    }
  }
  const device = !userAgent ? "unknown" : /ipad|tablet|android(?!.*mobile)/i.test(userAgent) ? "tablet" :
    /mobile|iphone|ipod/i.test(userAgent) ? "mobile" : "desktop";
  return {
    id: input.event_id, type: input.type, path: cleanPath(input.path, site), referrer,
    source: tag(input.utm_source), medium: tag(input.utm_medium), campaign: tag(input.utm_campaign),
    device, name, props,
  };
}

export function siteDay(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(timestamp);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dateRange(today: string, count: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}
