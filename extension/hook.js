// 运行在页面环境（MAIN world），document_start 注入
// 作用：抖音是单页应用，在推荐流里点开图文时页面不会重新加载，
// 作品数据只出现在接口返回里。这里拦截 fetch / XHR 的返回，缓存带图片的作品，
// 供 content.js 查询。只读取数据，不修改任何请求或响应。
(function () {
  "use strict";
  if (window.__dnvHooked) return;
  window.__dnvHooked = true;

  const DNV = window.DNV;
  const cache = new Map(); // awemeId -> 原始作品对象
  const MAX = 200;
  const API_RE = /\/aweme\/v\d+\/web\//;

  function remember(json) {
    try {
      const list = DNV.collectAwemesFromJson(json);
      for (const a of list) {
        const id = String(a.aweme_id || a.awemeId);
        cache.delete(id);
        cache.set(id, a);
        if (cache.size > MAX) cache.delete(cache.keys().next().value);
      }
    } catch (e) {
      /* 忽略 */
    }
  }

  // fetch
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : input && input.url;
        if (url && API_RE.test(url)) {
          p.then((res) => {
            try {
              res.clone().json().then(remember, () => {});
            } catch (e) {}
          }, () => {});
        }
      } catch (e) {}
      return p;
    };
  }

  // XMLHttpRequest
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (method, url) {
      try {
        this.__dnvUrl = String(url || "");
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XHR.send = function () {
      if (this.__dnvUrl && API_RE.test(this.__dnvUrl)) {
        this.addEventListener("load", function () {
          try {
            if (this.responseType === "json") remember(this.response);
            else if (this.responseType === "" || this.responseType === "text") {
              const t = this.responseText;
              if (t && t[0] === "{") remember(JSON.parse(t));
            }
          } catch (e) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  // 应答 content.js 的查询
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (ev.source !== window || !d || d.__dnv !== "req") return;
    const raw = d.id ? cache.get(String(d.id)) || null : null;
    let payload = null;
    try {
      payload = raw ? JSON.parse(JSON.stringify(raw)) : null;
    } catch (e) {}
    window.postMessage({ __dnv: "res", nonce: d.nonce, raw: payload }, "*");
  });
})();
