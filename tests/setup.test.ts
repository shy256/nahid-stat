import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("初始化创建本地配置，生成随机令牌且重复运行不覆盖", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mazda-setup-"));
  try {
    for (const file of [".env.example", "sites.example.json"]) copyFileSync(new URL(`../${file}`, import.meta.url), join(dir, file));
    const args = [process.execPath, fileURLToPath(new URL("../scripts/setup.ts", import.meta.url))];
    expect(Bun.spawnSync(args, { cwd: dir }).exitCode).toBe(0);
    const before = await Bun.file(join(dir, ".env")).text();
    expect(before).not.toContain("REPLACE_WITH");
    expect(before).toMatch(/ADMIN_TOKEN=[a-f0-9]{64}/);
    expect(before).toContain("SITE_CONFIG=sites.json");
    expect(await Bun.file(join(dir, "sites.json")).json()).toHaveLength(1);
    expect(Bun.spawnSync(args, { cwd: dir }).exitCode).toBe(0);
    expect(await Bun.file(join(dir, ".env")).text()).toBe(before);
  } finally { rmSync(dir, { recursive: true }); }
});
