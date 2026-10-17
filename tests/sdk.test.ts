import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkHandler } from "../src/sdk";
import { SDK_PATH } from "../src/version";

function request(handler: ReturnType<typeof createSdkHandler>, path: string, method = "GET") {
  const req = new Request(`https://stats.example.com${path}`, { method });
  return handler(req, new URL(req.url));
}

test("固定版本支持跨域、长期缓存和 HEAD；未知版本不回退到最新版", async () => {
  const sdk = createSdkHandler();
  const response = request(sdk, SDK_PATH)!;
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("javascript");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  expect(await response.text()).toBe(await Bun.file(new URL("../public/tracker.js", import.meta.url)).text());
  const head = request(sdk, SDK_PATH, "HEAD")!;
  expect(head.status).toBe(200);
  expect(head.headers.get("Cache-Control")).toBe(response.headers.get("Cache-Control"));
  expect(await head.text()).toBe("");
  for (const path of ["/mazda@999.0.0", "/mazda@", `${SDK_PATH}/extra`, "/mazda.js"]) expect(request(sdk, path)).toBeNull();
});

test("无版本地址与旧地址临时重定向，保留查询参数且不缓存重定向", async () => {
  const sdk = createSdkHandler();
  for (const path of ["/mazda", "/tracker.js"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = request(sdk, path + "?v=abc%2B123", method)!;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(SDK_PATH + "?v=abc%2B123");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await response.text()).toBe("");
    }
  }
  for (const path of ["/mazda", "/tracker.js", SDK_PATH]) {
    const response = request(sdk, path, "POST")!;
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
});

test("升级只移动无版本地址，历史版本保持原内容；缺少当前快照拒绝启动", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mazda-sdk-"));
  try {
    writeFileSync(join(dir, "0.1.0.js"), "// old SDK");
    writeFileSync(join(dir, "0.2.0.js"), "// new SDK");
    const old = createSdkHandler(dir, "0.1.0"), next = createSdkHandler(dir, "0.2.0");
    expect(request(old, "/mazda")!.headers.get("Location")).toBe("/mazda@0.1.0");
    expect(request(next, "/mazda")!.headers.get("Location")).toBe("/mazda@0.2.0");
    expect(await request(next, "/mazda@0.1.0")!.text()).toBe("// old SDK");
    expect(await request(next, "/mazda@0.2.0")!.text()).toBe("// new SDK");
    expect(() => createSdkHandler(dir, "0.3.0")).toThrow("缺少 SDK 0.3.0 快照");
  } finally { rmSync(dir, { recursive: true }); }
});

test("生成 SDK 快照可重复执行；拒绝覆盖已有版本，提升版本保留旧文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "mazda-sdk-release-"));
  try {
    mkdirSync(join(dir, "public"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.1.0" }));
    writeFileSync(join(dir, "public/tracker.js"), "// old SDK");
    const run = () => Bun.spawnSync([process.execPath, fileURLToPath(new URL("../scripts/release-sdk.ts", import.meta.url))], { cwd: dir });
    expect(run().exitCode).toBe(0);
    expect(run().exitCode).toBe(0);
    writeFileSync(join(dir, "public/tracker.js"), "// new SDK");
    const conflict = run();
    expect(conflict.exitCode).not.toBe(0);
    expect(conflict.stderr.toString()).toContain("请先提升 package.json 的版本号");
    expect(readFileSync(join(dir, "public/sdk/0.1.0.js"), "utf8")).toBe("// old SDK");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.2.0" }));
    expect(run().exitCode).toBe(0);
    expect(readFileSync(join(dir, "public/sdk/0.2.0.js"), "utf8")).toBe("// new SDK");
    expect(readFileSync(join(dir, "public/sdk/0.1.0.js"), "utf8")).toBe("// old SDK");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "../invalid" }));
    expect(run().exitCode).not.toBe(0);
  } finally { rmSync(dir, { recursive: true }); }
});
