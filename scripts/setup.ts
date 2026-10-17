import { randomBytes } from "node:crypto";
import { writeFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";

// wx / COPYFILE_EXCL 保证重复运行不会覆盖已有配置或轮换令牌。
try {
  await copyFile("sites.example.json", "sites.json", constants.COPYFILE_EXCL);
  console.log("已创建 sites.json；可在看板的站点配置中设置实际网站来源");
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
try {
  const template = await Bun.file(".env.example").text();
  const content = template.replace("REPLACE_WITH_A_RANDOM_TOKEN", randomBytes(32).toString("hex"));
  await writeFile(".env", content, { flag: "wx", mode: 0o600 });
  console.log("已生成 .env 和随机管理令牌；请在本地 .env 中查看 ADMIN_TOKEN，不要分享或提交此文件");
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
console.log("配置已就绪。运行 bun run dev，默认地址 http://127.0.0.1:3000/admin");
