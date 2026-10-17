import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SDK_VERSION_PATTERN, VERSION } from "./version";

export function createSdkHandler(directory = fileURLToPath(new URL("../public/sdk/", import.meta.url)), version = VERSION) {
  const releases = new Map<string, string>();
  for (const file of readdirSync(directory, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".js")) continue;
    const release = file.name.slice(0, -3);
    if (SDK_VERSION_PATTERN.test(release)) releases.set(`/mazda@${release}`, readFileSync(join(directory, file.name), "utf8"));
  }
  const latestPath = `/mazda@${version}`;
  if (!releases.has(latestPath)) throw new Error(`缺少 SDK ${version} 快照，请运行 bun run sdk:release`);

  return (req: Request, url: URL): Response | null => {
    const alias = url.pathname === "/mazda" || url.pathname === "/tracker.js";
    const body = releases.get(url.pathname);
    if (!alias && body === undefined) return null;
    const headers = new Headers({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (req.method !== "GET" && req.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD");
      return Response.json({ error: "方法不支持" }, { status: 405, headers });
    }
    if (alias) {
      headers.set("Location", latestPath + url.search);
      return new Response(null, { status: 302, headers });
    }
    headers.set("Content-Type", "text/javascript; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(req.method === "HEAD" ? null : body, { headers });
  };
}
