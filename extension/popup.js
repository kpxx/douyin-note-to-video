const $ = (id) => document.getElementById(id);

function showError(text) {
  $("status").textContent = text;
  $("status").className = "status err";
  $("status").hidden = false;
  $("note").hidden = true;
}

function formatSec(sec) {
  if (!sec) return "未知";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function queryTab(tab) {
  const ask = () => chrome.tabs.sendMessage(tab.id, { type: "dnv:getNote" });
  try {
    return await ask();
  } catch (e) {
    // 安装插件前就已打开的页面没有 content script，补注入一次
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/parse.js", "content.js"]
    });
    return await ask();
  }
}

async function openStudio(note, action) {
  await chrome.storage.session.set({ [`note:${note.id}`]: note });
  const url = chrome.runtime.getURL(`studio.html?id=${note.id}${action ? `&action=${action}` : ""}`);
  await chrome.tabs.create({ url });
  window.close();
}

function render(note) {
  $("status").hidden = true;
  $("note").hidden = false;
  $("author").textContent = note.author ? `@${note.author}` : "";
  $("desc").textContent = note.desc || "（无文案）";

  const thumbs = $("thumbs");
  thumbs.textContent = "";
  for (const im of note.images.slice(0, 6)) {
    const img = document.createElement("img");
    img.src = im.urls[0] || "";
    img.alt = `第 ${im.index} 张`;
    img.referrerPolicy = "no-referrer";
    thumbs.appendChild(img);
  }

  let count = `${note.images.length} 张`;
  if (note.liveCount) count += `（含 ${note.liveCount} 张实况）`;
  $("count").textContent = count;
  $("music").textContent = note.music
    ? `${note.music.title}${note.music.author ? " - " + note.music.author : ""}`
    : "无";
  $("duration").textContent = note.music ? formatSec(note.audioLengthSec) : "—";
  $("music").title = $("music").textContent;

  $("compose").onclick = () => openStudio(note);
  $("download").onclick = () => openStudio(note, "download");
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:\/\/www\.douyin\.com\//.test(tab.url || "")) {
    showError("请先在浏览器中打开一个抖音图文作品（网址形如 douyin.com/note/…），再点击插件。");
    return;
  }
  let res;
  try {
    res = await queryTab(tab);
  } catch (e) {
    showError("无法读取页面，请刷新抖音页面后再试。");
    return;
  }
  if (!res || !res.ok) {
    if (res && res.error === "no-id") {
      showError("当前页面不是单个作品。请点开一个图文作品，或在新标签页中打开它的链接。");
    } else {
      showError("没有找到作品数据。请刷新页面后再试；如仍失败，可能是抖音改版了，欢迎到 GitHub 提 Issue。");
    }
    return;
  }
  const note = res.note;
  if (!note.images.length) {
    showError("这是视频作品，不是图文作品。本插件只处理图文（多张图片 + 背景音乐）。");
    return;
  }
  render(note);
})();
