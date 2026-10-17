import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = process.env.DATABASE_PATH ?? "data/analytics.sqlite";
if (source === ":memory:") throw new Error("内存数据库不能使用文件备份命令");
if (!await Bun.file(source).exists()) throw new Error("源数据库不存在，请先启动并初始化服务");
const target = resolve(process.argv[2] ?? `data/backups/analytics-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
if (resolve(source) === target || await Bun.file(target).exists()) throw new Error("备份目标必须为未存在的新文件");
mkdirSync(dirname(target), { recursive: true });
const db = new Database(source, { readonly: true });
try {
  db.exec("PRAGMA busy_timeout = 5000");
  // 生成包含已提交 WAL 数据的一致性快照，不直接复制正在使用的主数据库文件。
  db.query("VACUUM INTO ?").run(target);
  console.log(`备份已写入 ${target}`);
} finally { db.close(true); }
