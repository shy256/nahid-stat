"use strict";
const $ = (id) => document.getElementById(id);
let token = "", revision = 0;
let sites = [];
const number = new Intl.NumberFormat("zh-CN");
function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function logout() {
  revision++;
  token = "";
  sites = [];
  $("token").value = "";
  $("dashboard").hidden = true;
  $("login").hidden = false;
  $("site").replaceChildren();
  ["pages", "sources", "devices", "events", "chart", "admin-links"].forEach((id) => $(id).replaceChildren());
  status("");
}
async function api(path) {
  const response = await fetch(path, { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) logout();
    throw new Error(data.error || "请求失败");
  }
  return data;
}
function ranking(id, rows, names = {}) {
  const container = $(id);
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无数据";
    container.append(empty);
    return;
  }
  const list = document.createElement("ol");
  list.className = "ranking";
  const max = Math.max(1, ...rows.map((row) => row.count));
  rows.forEach((row, index) => {
    const li = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "row-index";
    rank.setAttribute("aria-hidden", "true");
    rank.textContent = String(index + 1).padStart(2, "0");
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = names[row.value] || row.value;
    label.title = names[row.value] || row.value;
    const count = document.createElement("strong");
    count.textContent = number.format(row.count);
    const bar = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    bar.setAttribute("class", "row-bar");
    bar.setAttribute("viewBox", "0 0 100 2");
    bar.setAttribute("preserveAspectRatio", "none");
    bar.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS(bar.namespaceURI, "rect");
    rect.setAttribute("width", String(row.count / max * 100));
    rect.setAttribute("height", "2");
    bar.append(rect);
    li.append(rank, label, count, bar);
    list.append(li);
  });
  container.append(list);
}
function adminLinks() {
  const site = sites.find((site) => site.id === $("site").value);
  $("admin-links").replaceChildren();
  (site?.origins || []).forEach((origin) => {
    const row = document.createElement("div");
    row.className = "admin-link-row";
    const label = document.createElement("span");
    label.textContent = origin;
    row.append(label);
    [ ["1", "标记管理员浏览器"], ["0", "取消标记"] ].forEach(([value, text]) => {
      const url = new URL(origin);
      url.searchParams.set("mazda_admin", value);
      url.searchParams.set("mazda_site", site.id);
      const link = document.createElement("a");
      link.href = url.href;
      link.textContent = text;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      row.append(link);
    });
    $("admin-links").append(row);
  });
}
async function load() {
  const current = ++revision;
  adminLinks();
  status("正在读取统计…");
  try {
    const data = await api(`/api/stats?site_id=${encodeURIComponent($("site").value)}&days=${$("days").value}`);
    if (current !== revision) return;
    $("site-title").textContent = data.site.name;
    $("range-label").textContent = `${data.range.from} — ${data.range.to} · ${data.site.timezone}`;
    $("pv").textContent = number.format(data.totals.pageviews);
    $("event-total").textContent = number.format(data.totals.events);
    ranking("pages", data.pages);
    ranking("sources", data.sources, { "(direct)": "直接访问 / 来源未知" });
    ranking("devices", data.devices, { mobile: "手机", tablet: "平板", desktop: "桌面", unknown: "未知设备" });
    ranking("events", data.events);
    const peak = Math.max(1, ...data.trend.map((row) => row.pageviews));
    const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
    const step = Math.max(1, [1, 2, 5, 10].find((value) => value * magnitude >= peak / 4) * magnitude);
    const max = step * 4;
    $("chart-scale").replaceChildren();
    for (let index = 4; index >= 0; index--) {
      const tick = document.createElement("span");
      tick.textContent = number.format(index * step);
      $("chart-scale").append(tick);
    }
    $("chart").replaceChildren();
    data.trend.forEach((row) => {
      const slot = document.createElement("div");
      slot.className = "bar-slot";
      const bar = document.createElement("div");
      bar.className = "bar";
      const height = row.pageviews / max * 100;
      // SVG presentation attributes keep the dashboard's CSP free of inline styles.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      const rect = document.createElementNS(svg.namespaceURI, "rect");
      rect.setAttribute("x", "0"); rect.setAttribute("y", String(100 - height));
      rect.setAttribute("width", "100"); rect.setAttribute("height", String(height));
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = `${row.day}：${number.format(row.pageviews)} 次浏览`;
      svg.append(title, rect); bar.append(svg);
      slot.title = title.textContent;
      slot.append(bar);
      $("chart").append(slot);
    });
    $("axis-start").textContent = data.range.from;
    $("axis-end").textContent = data.range.to;
    $("trend-empty").hidden = data.totals.pageviews > 0;
    $("chart-frame").hidden = data.totals.pageviews === 0;
    status("更新于 " + new Date().toLocaleTimeString("zh-CN"));
  } catch (error) { if (current === revision || !token) status(error.message, true); }
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  token = $("token").value;
  status("正在连接…");
  try {
    sites = await api("/api/sites");
    $("site").replaceChildren();
    sites.forEach((site) => {
      const option = document.createElement("option");
      option.value = site.id; option.textContent = site.name; $("site").append(option);
    });
    $("token").value = "";
    $("login").hidden = true;
    $("dashboard").hidden = false;
    await load();
  } catch (error) { token = ""; status(error.message, true); }
});
$("site").addEventListener("change", load);
$("days").addEventListener("change", load);
$("refresh").addEventListener("click", load);
$("logout").addEventListener("click", logout);
