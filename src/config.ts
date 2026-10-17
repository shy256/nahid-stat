export interface Site {
  id: string;
  name: string;
  origins: string[];
  timezone: string;
  events: Record<string, string[]>;
  redactPaths: string[];
}

export interface Config {
  host: string;
  port: number;
  adminToken: string;
  databasePath: string;
  retentionDays: number;
  enableDemo: boolean;
  sites: Site[];
  sitesPath?: string;
}

const namePattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
export function validateSites(input: unknown): Site[] {
  if (!Array.isArray(input) || input.length > 100) {
    throw new Error("站点配置需要包含 0–100 个站点");
  }
  const ids = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("站点配置无效");
    const site = value as Site;
    if (typeof site.id !== "string" || !namePattern.test(site.id) || ids.has(site.id)) throw new Error("站点 ID 无效或重复");
    ids.add(site.id);
    if (typeof site.name !== "string" || !site.name.trim() || site.name.length > 100) {
      throw new Error("站点名称无效");
    }
    if (!Array.isArray(site.origins) || !site.origins.length || site.origins.length > 20) {
      throw new Error("站点必须指定允许的 origins");
    }
    for (const origin of site.origins) {
      if (typeof origin !== "string" || origin.length > 2048) throw new Error("origin 必须为完整 HTTP(S) 来源");
      let url: URL;
      try { url = new URL(origin); }
      catch { throw new Error("origin 必须为完整 HTTP(S) 来源"); }
      if (!/^https?:$/.test(url.protocol) || url.origin !== origin) {
        throw new Error("origin 必须为完整 HTTP(S) 来源，不含路径或末尾斜杠");
      }
    }
    if (typeof site.timezone !== "string" || !site.timezone.trim()) throw new Error("必须指定站点时区");
    try { new Intl.DateTimeFormat("en", { timeZone: site.timezone }).format(); }
    catch { throw new Error("站点时区无效，请使用 Asia/Shanghai、UTC 等时区名称"); }
    const events = site.events ?? {};
    if (!events || Array.isArray(events) || typeof events !== "object" || Object.keys(events).length > 50) {
      throw new Error("events 配置无效");
    }
    for (const [name, keys] of Object.entries(events)) {
      if (!namePattern.test(name) || !Array.isArray(keys) || keys.length > 8 ||
          keys.some((key) => typeof key !== "string" || !namePattern.test(key))) {
        throw new Error("事件名称或属性白名单无效");
      }
    }
    const redactPaths = site.redactPaths ?? [];
    if (!Array.isArray(redactPaths) || redactPaths.length > 20) throw new Error("redactPaths 配置无效");
    for (const pattern of redactPaths) {
      if (typeof pattern !== "string" || pattern.length > 200) throw new Error("路径脱敏规则无效");
      try { new RegExp(pattern); }
      catch { throw new Error("路径脱敏正则表达式无效"); }
    }
    return { id: site.id, name: site.name.trim(), origins: [...new Set(site.origins)], timezone: site.timezone, events, redactPaths };
  });
}

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error("环境变量整数超出范围");
  return number;
}

export async function loadConfig(): Promise<Config> {
  const adminToken = process.env.ADMIN_TOKEN ?? "";
  if (adminToken.length < 24 || adminToken.includes("REPLACE_WITH")) {
    throw new Error("请设置至少 24 个字符的随机 ADMIN_TOKEN；不能使用示例占位值");
  }
  const sitesPath = process.env.SITE_CONFIG ?? "sites.json";
  let input: unknown;
  try { input = await Bun.file(sitesPath).json(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    input = [];
  }
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: integer(process.env.PORT, 3000, 1, 65535),
    adminToken,
    databasePath: process.env.DATABASE_PATH ?? "data/analytics.sqlite",
    retentionDays: integer(process.env.RETENTION_DAYS, 30, 1, 365),
    enableDemo: process.env.ENABLE_DEMO === "true",
    sitesPath,
    sites: validateSites(input),
  };
}
