import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SDK_VERSION_PATTERN } from "../src/version";

// 仅生成本地快照，不发布或部署；已有版本内容不可覆盖。
const { version } = await Bun.file("package.json").json();
if (typeof version !== "string" || !SDK_VERSION_PATTERN.test(version)) throw new Error("package.json 中的版本号无效");
const source = await readFile("public/tracker.js");
const target = `public/sdk/${version}.js`;
await mkdir("public/sdk", { recursive: true });
try {
  await writeFile(target, source, { flag: "wx" });
  console.log(`已生成 SDK 快照：${target}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  if (!source.equals(await readFile(target))) throw new Error(`SDK ${version} 已存在且内容不同；请先提升 package.json 的版本号`);
  console.log(`SDK ${version} 快照已存在，内容一致`);
}
