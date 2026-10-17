import { loadConfig } from "./config";
import { createStore } from "./database";
import { createApp } from "./app";

const config = await loadConfig();
const store = createStore(config.databasePath);
const handle = createApp(config, store);
store.cleanup(Date.now(), config.retentionDays);
const cleanupTimer = setInterval(() => {
  try { store.cleanup(Date.now(), config.retentionDays); }
  catch { console.error("过期明细清理失败"); }
}, 60 * 60 * 1000);
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: 32 * 1024,
  idleTimeout: 10,
  fetch(req, server) {
    // 仅使用连接来源；不信任任意 X-Forwarded-For。
    return handle(req, server.requestIP(req)?.address ?? "unknown");
  },
});
console.log(`Mazda Analytics: ${server.url}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanupTimer);
  await server.stop();
  store.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
