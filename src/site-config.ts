import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateSites, type Config } from "./config";
import { HttpError } from "./events";

export const MAX_SITE_CONFIG_BODY = 4 * 1024 * 1024;

// 单实例内串行保存；临时文件与目标同目录，替换成功后才切换运行配置。
export function createSiteConfig(config: Config) {
  const version = () => `"${createHash("sha256").update(JSON.stringify(config.sites)).digest("hex")}"`;
  let pending: Promise<unknown> = Promise.resolve();
  function save(input: unknown, expected: string | null) {
    const operation = pending.then(async () => {
      if (!config.sitesPath) throw new HttpError(503, "未配置站点文件保存路径");
      if (!expected) throw new HttpError(428, "请先读取站点配置后再保存");
      if (expected !== version()) throw new HttpError(409, "站点配置已更新，请重新载入后再保存");
      let sites;
      try { sites = validateSites(input); }
      catch (error) { throw new HttpError(400, (error as Error).message); }
      const path = resolve(config.sitesPath);
      // 手工修改文件后必须重启，避免网页保存静默覆盖磁盘上的修改。
      try {
        const disk = validateSites(JSON.parse(await readFile(path, "utf8")));
        if (JSON.stringify(disk) !== JSON.stringify(config.sites)) {
          throw new HttpError(409, "站点文件已被外部修改，请重启服务后重新载入");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporary, JSON.stringify(sites, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
        config.sites = sites;
      } finally {
        await unlink(temporary).catch(() => {});
      }
    });
    pending = operation.catch(() => {});
    return operation;
  }
  return { version, save };
}
