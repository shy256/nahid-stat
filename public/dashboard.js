"use strict";
const $ = (id) => document.getElementById(id);
let token = "", revision = 0, session = 0, sitesVersion = "";
let sites = [];
let editingId = null, settingsDirty = false, settingsBusy = false;
const number = new Intl.NumberFormat("zh-CN");
function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function logout() {
  session++;
  revision++;
  token = "";
  sites = [];
  sitesVersion = "";
  settingsDirty = false;
  settingsBusy = false;
  $("site-form").reset();
  $("event-rules").replaceChildren();
  $("settings-site").replaceChildren();
  $("site-snippet").value = "";
  $("settings-status").textContent = "";
  setSettingsBusy(false);
  showSettings(false);
  $("token").value = "";
  $("dashboard").hidden = true;
  $("login").hidden = false;
  $("site").replaceChildren();
  ["pages", "sources", "devices", "events", "chart", "admin-links"].forEach((id) => $(id).replaceChildren());
  status("");
}
async function api(path, options = {}, resetOnUnauthorized = true) {
  const currentSession = session;
  const response = await fetch(path, { ...options, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...options.headers }, credentials: "same-origin", cache: "no-store" });
  const data = await response.json();
  if (currentSession !== session) throw new Error("登录状态已改变");
  if (!response.ok) {
    if (response.status === 401 && resetOnUnauthorized) logout();
    throw new Error(data.error || "请求失败");
  }
  if (path === "/admin/api/sites") sitesVersion = response.headers.get("ETag") || "";
  return data;
}

function settingsStatus(message, error = false) {
  $("settings-status").textContent = message;
  $("settings-status").classList.toggle("error", error);
}
function showSettings(open) {
  $("site-settings").hidden = !open;
  $("configure").setAttribute("aria-expanded", String(open));
}
function setSettingsBusy(busy) {
  settingsBusy = busy;
  ["site-fields", "settings-site", "site-new", "settings-reload", "settings-close"].forEach((id) => { $(id).disabled = busy; });
  $("site-save").textContent = busy ? "正在保存…" : "保存配置";
}
function siteOptions(preferred = $("site").value) {
  ["site", "settings-site"].forEach((id) => {
    $(id).replaceChildren();
    sites.forEach((site) => {
      const option = document.createElement("option");
      option.value = site.id;
      option.textContent = id === "site" ? site.name : `${site.name} · ${site.id}`;
      $(id).append(option);
    });
    if (sites.some((site) => site.id === preferred)) $(id).value = preferred;
  });
  $("site").disabled = !sites.length;
  $("days").disabled = !sites.length;
  $("refresh").disabled = !sites.length;
  $("site-stats").hidden = !sites.length;
  $("no-sites").hidden = !!sites.length;
}
function eventRule(name = "", keys = []) {
  const row = document.createElement("div");
  row.className = "event-rule";
  const event = document.createElement("input");
  event.value = name; event.placeholder = "download"; event.required = true; event.maxLength = 64;
  event.pattern = "[a-zA-Z][a-zA-Z0-9_-]{0,63}";
  event.setAttribute("aria-label", "事件名称");
  const properties = document.createElement("input");
  properties.value = keys.join(", "); properties.placeholder = "file_type, category";
  properties.setAttribute("aria-label", "允许的属性（英文逗号分隔）");
  const remove = document.createElement("button");
  remove.type = "button"; remove.className = "text-button"; remove.textContent = "移除";
  remove.setAttribute("aria-label", "移除此事件");
  remove.addEventListener("click", () => { row.remove(); settingsDirty = true; });
  row.append(event, properties, remove);
  $("event-rules").append(row);
}
function editSite(id) {
  const site = sites.find((site) => site.id === id);
  editingId = site?.id ?? null;
  $("settings-site").value = editingId ?? "";
  $("site-id").value = site?.id ?? "";
  $("site-id").readOnly = !!site;
  $("site-name").value = site?.name ?? "";
  $("site-origins").value = site?.origins.join("\n") ?? "";
  $("site-timezone").value = site?.timezone ?? "Asia/Shanghai";
  $("site-redact").value = site?.redactPaths.join("\n") ?? "";
  $("event-rules").replaceChildren();
  Object.entries(site?.events ?? {}).forEach(([name, keys]) => eventRule(name, keys));
  $("site-delete").hidden = !site;
  $("delete-confirm").hidden = true;
  $("site-integration").hidden = !site;
  const script = document.createElement("script");
  script.defer = true; script.src = new URL("__MAZDA_SDK_PATH__", location.href).href;
  script.dataset.site = site?.id ?? "";
  $("site-snippet").value = site ? script.outerHTML : "";
  settingsDirty = false;
  settingsStatus("");
}
function discardEdits() {
  return !settingsDirty || window.confirm("有尚未保存的站点配置，确认放弃修改？");
}
async function saveSites(next, preferred, message) {
  const currentSession = session;
  setSettingsBusy(true);
  settingsStatus("正在保存…");
  try {
    const saved = await api("/admin/api/sites", {
      method: "PUT", headers: { "Content-Type": "application/json", "If-Match": sitesVersion }, body: JSON.stringify(next),
    });
    if (currentSession !== session) return;
    sites = saved;
    siteOptions(preferred);
    editSite($("site").value);
    await load();
    if (currentSession === session) settingsStatus(message);
  } catch (error) {
    if (currentSession === session) settingsStatus(error.message, true);
  } finally { if (currentSession === session) setSettingsBusy(false); }
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
  if (!sites.length) {
    $("site-title").textContent = "网站概览";
    $("range-label").textContent = "";
    ["pages", "sources", "devices", "events", "chart", "admin-links"].forEach((id) => $(id).replaceChildren());
    status("");
    return;
  }
  status("正在读取统计…");
  try {
    const data = await api(`/admin/api/stats?site_id=${encodeURIComponent($("site").value)}&days=${$("days").value}`);
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
  } catch (error) { if (current === revision) status(error.message, true); }
}
async function login(manual = false) {
  const currentSession = ++session;
  token = manual ? $("token").value : "";
  if (manual) status("正在连接…");
  try {
    const loaded = await api("/admin/api/sites", {}, false);
    if (currentSession !== session) return;
    sites = loaded;
    siteOptions();
    $("token").value = "";
    $("login").hidden = true;
    $("dashboard").hidden = false;
    if (!sites.length) { editSite(null); showSettings(true); }
    await load();
  } catch (error) {
    if (currentSession === session) { token = ""; if (manual) status(error.message, true); }
  }
}
$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void login(true);
});
$("configure").addEventListener("click", () => {
  if (settingsBusy) return;
  if (!$("site-settings").hidden) {
    if (discardEdits()) { settingsDirty = false; showSettings(false); }
  } else { editSite($("site").value); showSettings(true); }
});
$("settings-close").addEventListener("click", () => {
  if (discardEdits()) { settingsDirty = false; showSettings(false); }
});
$("settings-site").addEventListener("change", () => {
  if (discardEdits()) editSite($("settings-site").value);
  else $("settings-site").value = editingId ?? "";
});
$("site-new").addEventListener("click", () => {
  if (discardEdits()) { editSite(null); $("site-id").focus(); }
});
$("settings-reload").addEventListener("click", async () => {
  if (!discardEdits()) return;
  const currentSession = session;
  setSettingsBusy(true);
  try {
    const loaded = await api("/admin/api/sites");
    if (currentSession !== session) return;
    sites = loaded;
    siteOptions(); editSite($("site").value);
    await load();
    if (currentSession === session) settingsStatus("已载入最新配置");
  } catch (error) { if (currentSession === session) settingsStatus(error.message, true); }
  finally { if (currentSession === session) setSettingsBusy(false); }
});
$("site-form").addEventListener("input", () => { settingsDirty = true; $("delete-confirm").hidden = true; });
$("event-add").addEventListener("click", () => { eventRule(); settingsDirty = true; });
$("site-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (settingsBusy) return;
  const entries = [];
  for (const row of $("event-rules").children) {
    const [name, properties] = row.querySelectorAll("input");
    if (entries.some(([key]) => key === name.value.trim())) { settingsStatus("事件名称重复", true); return; }
    entries.push([name.value.trim(), properties.value.split(",").map((key) => key.trim()).filter(Boolean)]);
  }
  const lines = (id) => $(id).value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const site = {
    id: $("site-id").value.trim(), name: $("site-name").value.trim(), origins: lines("site-origins"),
    timezone: $("site-timezone").value.trim(), events: Object.fromEntries(entries), redactPaths: lines("site-redact"),
  };
  if (editingId === null && sites.some((existing) => existing.id === site.id)) { settingsStatus("站点 ID 已存在", true); return; }
  const next = editingId === null ? [...sites, site] : sites.map((existing) => existing.id === editingId ? site : existing);
  await saveSites(next, site.id, "站点配置已保存并立即生效");
});
$("site-delete").addEventListener("click", () => { $("delete-confirm").hidden = false; });
$("delete-no").addEventListener("click", () => { $("delete-confirm").hidden = true; });
$("delete-yes").addEventListener("click", async () => {
  if (settingsBusy || editingId === null) return;
  await saveSites(sites.filter((site) => site.id !== editingId), $("site").value, "站点已移除，历史统计数据已保留");
});
window.addEventListener("beforeunload", (event) => {
  if (settingsDirty) { event.preventDefault(); event.returnValue = ""; }
});
$("site").addEventListener("change", load);
$("days").addEventListener("change", load);
$("refresh").addEventListener("click", load);
$("logout").addEventListener("click", logout);
void login();
