"use strict";
const status = document.getElementById("demo-status");
status.textContent = window.mazda?.isAdmin ? "此浏览器已标记为管理员，测试访问和事件不计入统计。" : window.mazda ? "采集脚本已就绪。首次浏览事件将在约 1 秒后发送。" : "采集已关闭，请检查 Do Not Track / GPC 设置。";
document.getElementById("download").addEventListener("click", async () => {
  if (!window.mazda) return;
  if (window.mazda.isAdmin) { status.textContent = "管理员测试事件已忽略，不计入统计。"; return; }
  window.mazda.track("download", { file_type: "pdf" });
  await window.mazda.flush();
  status.textContent = "已尝试发送 download 事件，请在看板确认送达。";
});
document.getElementById("route").addEventListener("click", () => {
  history.pushState({}, "", "/demo/article?secret=should-not-be-collected");
  status.textContent = window.mazda?.isAdmin ? "已切换路由，管理员测试访问不计入统计。刷新请返回 /demo。" : "已切换路由；仅上报 /demo/article，丢弃查询参数。刷新请返回 /demo。";
});
document.getElementById("same-route").addEventListener("click", () => {
  history.replaceState({}, "", location.href);
  status.textContent = "已重复当前路由，不应产生额外页面浏览事件。";
});
