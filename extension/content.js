// 运行在扩展隔离环境，负责回答弹窗的「当前页面是哪个图文作品」查询
(function () {
  "use strict";
  const DNV = globalThis.DNV;

  // 1. 问页面环境里的 hook.js（单页应用里点开的作品）
  function askHook(id) {
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      const timer = setTimeout(done, 400, null);
      function done(raw) {
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve(raw);
      }
      function onMsg(ev) {
        const d = ev.data;
        if (ev.source === window && d && d.__dnv === "res" && d.nonce === nonce) done(d.raw);
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ __dnv: "req", id, nonce }, "*");
    });
  }

  // 2. 读取当前页面 SSR 里的 self.__pace_f
  function readPageFlight(id) {
    const chunks = [];
    for (const s of document.scripts) {
      const t = s.textContent;
      if (!t || !t.startsWith("self.__pace_f.push(")) continue;
      try {
        chunks.push(JSON.parse(t.slice("self.__pace_f.push(".length).replace(/\)\s*;?\s*$/, "")));
      } catch (e) {}
    }
    return DNV.findAwemeInFlight(DNV.joinFlight(chunks), id);
  }

  // 3. 重新请求作品页面（同源，带登录状态），从 HTML 里解析
  async function fetchNotePage(id) {
    for (const path of [`/note/${id}`, `/video/${id}`]) {
      try {
        const res = await fetch(path, { credentials: "include" });
        if (!res.ok) continue;
        const raw = DNV.findAwemeInHtml(await res.text(), id);
        if (raw) return raw;
      } catch (e) {}
    }
    return null;
  }

  async function getNote() {
    const id = DNV.extractAwemeId(location.href);
    if (!id) return { ok: false, error: "no-id" };

    let raw = await askHook(id);
    let source = "api";
    if (!raw) {
      raw = readPageFlight(id);
      source = "page";
    }
    if (!raw) {
      raw = await fetchNotePage(id);
      source = "fetch";
    }
    if (!raw) return { ok: false, error: "not-found", id };

    const note = DNV.normalizeAweme(raw);
    note.pageUrl = `https://www.douyin.com/note/${id}`;
    return { ok: true, source, note };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "dnv:getNote") return;
    getNote()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // 异步应答
  });
})();
