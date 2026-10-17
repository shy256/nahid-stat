(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !script.dataset.site || window.mazda) return;
  var site = script.dataset.site;
  var endpoint = new URL("/api/collect", script.src).href;
  var queue = [], timer, busy = false, lastPath = "";
  var adminKey = "mazda:admin:" + site, admin = false, generation = 0, storageAvailable = true;
  function changeAdmin(value) {
    if (admin === value) return;
    admin = value;
    generation++;
    queue = [];
    lastPath = "";
    clearTimeout(timer);
  }
  function isAdmin() {
    if (storageAvailable) {
      try { changeAdmin(localStorage.getItem(adminKey) === "1"); } catch (_) { storageAvailable = false; }
    }
    return admin;
  }
  function setAdmin(value) {
    if (typeof value !== "boolean") return false;
    changeAdmin(value);
    try {
      if (value) localStorage.setItem(adminKey, "1");
      else localStorage.removeItem(adminKey);
      storageAvailable = true;
      return true;
    } catch (_) { storageAvailable = false; return false; }
  }
  isAdmin();
  var referrer = "";
  try { referrer = new URL(document.referrer).hostname; } catch (_) {}
  var params = new URLSearchParams(location.search);
  // 在首次 PV 前处理标记；只在被测网站保存，不传递管理令牌。
  var adminParam = params.get("mazda_admin"), adminSite = params.get("mazda_site");
  if ((adminParam === "1" || adminParam === "0") && (adminSite === null || adminSite === site)) {
    setAdmin(adminParam === "1");
    try {
      var cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("mazda_admin");
      cleanUrl.searchParams.delete("mazda_site");
      history.replaceState(history.state, "", cleanUrl.href);
    } catch (_) {}
  }
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  function id() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, function (v) { return v.toString(16).padStart(2, "0"); }).join("");
  }
  function tag(value) { return value && /^[a-zA-Z0-9_. -]{1,64}$/.test(value) ? value : ""; }
  function path(value) { return (value || location.pathname).split(/[?#]/)[0]; }
  function schedule(delay) {
    clearTimeout(timer);
    if (queue.length) timer = setTimeout(flush, delay || 1000);
  }
  function enqueue(type, name, props, pagePath) {
    if (isAdmin()) return false;
    if (queue.length >= 100) return false;
    var page = path(pagePath);
    if (page.length > 2048 || !page.startsWith("/") || page.startsWith("//")) return false;
    var event = {
      v: 1, event_id: id(), type: type, path: page, referrer_host: referrer,
      utm_source: tag(params.get("utm_source")), utm_medium: tag(params.get("utm_medium")),
      utm_campaign: tag(params.get("utm_campaign"))
    };
    if (type === "event") {
      event.name = name;
      event.props = {};
      Object.keys(props || {}).slice(0, 8).forEach(function (key) {
        var value = props[key];
        if (/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) &&
            (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ||
             (typeof value === "string" && value.length <= 64 && /^[a-zA-Z0-9_. -]*$/.test(value)))) event.props[key] = value;
      });
    }
    queue.push({ event: event, retries: 0 });
    schedule();
    return true;
  }
  function payload(batch) { return JSON.stringify({ site_id: site, events: batch.map(function (item) { return item.event; }) }); }
  function nextBatch(max) {
    var batch = queue.slice(0, max);
    // 长路径或多个属性也不能让批次超过服务端的 32 KiB 限额。
    while (batch.length > 1 && new TextEncoder().encode(payload(batch)).byteLength > 30000) batch.pop();
    return batch;
  }
  async function flush() {
    clearTimeout(timer);
    if (isAdmin()) return;
    if (busy || !queue.length) return;
    busy = true;
    var batchGeneration = generation;
    var batch = nextBatch(20), retry = false;
    queue.splice(0, batch.length);
    try {
      var response = await fetch(endpoint, {
        method: "POST", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: payload(batch), signal: AbortSignal.timeout(10000)
      });
      retry = response.status === 429 || response.status >= 500;
    } catch (_) { retry = true; }
    if (retry && !isAdmin() && generation === batchGeneration) {
      batch = batch.filter(function (item) { return ++item.retries <= 3; });
      queue = batch.concat(queue).slice(0, 100);
    }
    busy = false;
    schedule(retry ? (batch[0] ? Math.min(60000, 5000 * Math.pow(2, batch[0].retries)) : 1000) : 1000);
  }
  function page(options) {
    var next = path(options && options.path);
    if (next === lastPath) return false;
    if (!enqueue("pageview", "", {}, next)) return false;
    lastPath = next;
    return true;
  }
  window.mazda = {
    page: page, track: function (name, props) { return enqueue("event", name, props, lastPath || undefined); }, flush: flush,
    setAdmin: setAdmin, get isAdmin() { return isAdmin(); }
  };
  window.addEventListener("storage", function (event) {
    if (event.key === adminKey || event.key === null) isAdmin();
  });
  if (script.dataset.auto !== "false") {
    page();
    ["pushState", "replaceState"].forEach(function (method) {
      var original = history[method];
      history[method] = function () {
        var result = original.apply(this, arguments);
        page();
        return result;
      };
    });
    window.addEventListener("popstate", function () { page(); });
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) { lastPath = ""; page(); }
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "hidden") return;
    clearTimeout(timer);
    if (isAdmin()) return;
    // 分小批发送；false 表示未入队，保留该批待页面恢复后重试。
    while (queue.length) {
      var batch = nextBatch(10);
      if (!navigator.sendBeacon(endpoint, payload(batch))) break;
      queue.splice(0, batch.length);
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") schedule();
  });
})();
