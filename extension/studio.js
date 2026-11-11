// 合成工作台：下载素材 + 用 ffmpeg.wasm 在本地合成 MP4
import { FFmpeg } from "./vendor/ffmpeg/index.js";

const DNV = globalThis.DNV;
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const noteId = params.get("id");
let note = null;
const fileCache = new Map(); // url key -> { bytes, ext, mime }
let ffmpeg = null;
let outputUrl = null;
let busy = false;

// ---------- 工具 ----------

function fatal(msg) {
  $("fatal").textContent = msg;
  $("fatal").hidden = false;
  $("work").hidden = true;
}

function formatSec(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatBytes(n) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function setProgress(ratio, text, isErr) {
  $("progress").hidden = false;
  if (ratio != null) $("bar").style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  if (text != null) $("stage").textContent = text;
  $("stage").className = isErr ? "stage err" : "stage";
}

function log(line) {
  const pre = $("log");
  pre.textContent += line + "\n";
  if (pre.textContent.length > 60000) pre.textContent = pre.textContent.slice(-40000);
  pre.scrollTop = pre.scrollHeight;
}

function setBusy(v) {
  busy = v;
  $("compose").disabled = v;
  $("download").disabled = v;
}

// 根据文件头判断格式
function sniff(bytes, fallbackMime) {
  const b = bytes;
  const ascii = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: "jpg", mime: "image/jpeg" };
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return { ext: "png", mime: "image/png" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: "mp3", mime: "audio/mpeg" };
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (/^M4A|^M4B/.test(brand)) return { ext: "m4a", mime: "audio/mp4" };
    return { ext: "mp4", mime: "video/mp4" };
  }
  if (ascii(0, 4) === "OggS") return { ext: "ogg", mime: "audio/ogg" };
  const m = (fallbackMime || "").toLowerCase();
  if (m.includes("jpeg")) return { ext: "jpg", mime: m };
  if (m.includes("webp")) return { ext: "webp", mime: m };
  if (m.includes("mpeg")) return { ext: "mp3", mime: m };
  if (m.includes("mp4")) return { ext: "mp4", mime: m };
  return { ext: "bin", mime: m || "application/octet-stream" };
}

// 依次尝试地址列表里的每个镜像
async function fetchAny(urls, label) {
  const key = urls[0];
  if (fileCache.has(key)) return fileCache.get(key);
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 64) throw new Error("文件为空");
      const info = { bytes, ...sniff(bytes, res.headers.get("content-type")) };
      fileCache.set(key, info);
      return info;
    } catch (e) {
      lastErr = e;
      log(`[fetch] ${label} 失败：${e.message} ${url.slice(0, 80)}…`);
    }
  }
  throw new Error(
    `${label}下载失败（${lastErr ? lastErr.message : "未知错误"}）。素材链接可能已过期，请回到抖音页面刷新后重新打开插件。`
  );
}

function baseName() {
  return `${note.id}_${DNV.safeFileName(note.desc || note.author || "douyin", 24)}`;
}

// 部分 Linux 系统（非 UTF-8 locale）不接受中文文件名，失败时改用纯 ASCII 名称
function asciiFallback(filename) {
  const parts = filename.split("/");
  const file = parts.pop();
  const ext = (file.match(/\.[A-Za-z0-9]+$/) || [""])[0];
  const stem = file.slice(0, file.length - ext.length).replace(/[^\x20-\x7e]+/g, "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `douyin-notes/${note.id}/${stem || "file"}${ext}`;
}

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const opts = { url, filename, conflictAction: "uniquify", saveAs: false };
  try {
    try {
      await chrome.downloads.download(opts);
    } catch (e) {
      if (!/filename/i.test(e.message || "")) throw e;
      await chrome.downloads.download({ ...opts, filename: asciiFallback(filename) });
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// ---------- 设置 ----------

function readOptions() {
  const per = document.querySelector('input[name="per"]:checked').value;
  return {
    perImage: per === "auto" ? "auto" : Number($("perSec").value) || 3,
    lengthMode: document.querySelector('input[name="len"]:checked').value,
    sizePreset: $("size").value,
    fps: Number($("fps").value),
    crf: Number($("crf").value)
  };
}

function updateSummary() {
  if (!note) return;
  const o = readOptions();
  const fake = note.images.map((_, i) => `img${i}`);
  const plan = DNV.buildComposePlan({
    imageFiles: fake,
    audioFile: note.music ? "music" : null,
    audioStartSec: note.audioStartSec,
    audioLengthSec: note.audioLengthSec,
    perImage: o.perImage,
    lengthMode: o.lengthMode,
    size: DNV.resolveSize(note.images, o.sizePreset),
    fps: o.fps,
    crf: o.crf
  });
  const [w, h] = DNV.resolveSize(note.images, o.sizePreset);
  $("summary").textContent =
    `输出 ${w}×${h}，每张 ${plan.perImage.toFixed(1)} 秒，视频共 ${formatSec(plan.totalSec)}` +
    (plan.entries > note.images.length ? `（图片循环 ${Math.ceil(plan.entries / note.images.length)} 轮）` : "");
}

// ---------- 渲染 ----------

function render() {
  document.title = `${note.author ? "@" + note.author + " · " : ""}抖音图文转视频`;
  $("work").hidden = false;
  $("author").textContent = note.author ? `@${note.author}` : "";
  $("desc").textContent = note.desc || "（无文案）";
  $("source").href = note.pageUrl;
  $("source").hidden = false;

  const g = $("gallery");
  g.textContent = "";
  for (const im of note.images) {
    const li = document.createElement("li");
    const img = document.createElement("img");
    img.src = im.urls[0] || "";
    img.loading = "lazy";
    img.alt = `第 ${im.index} 张`;
    li.appendChild(img);
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = im.index;
    li.appendChild(idx);
    if (im.liveUrls.length) {
      const live = document.createElement("span");
      live.className = "live";
      live.textContent = "实况";
      li.appendChild(live);
    }
    if (im.width) {
      const dim = document.createElement("span");
      dim.className = "dim";
      dim.textContent = `${im.width}×${im.height}`;
      li.appendChild(dim);
    }
    g.appendChild(li);
  }

  if (note.music) {
    $("musicCard").hidden = false;
    $("musicTitle").textContent = note.music.title || "背景音乐";
    $("musicSub").textContent =
      [note.music.author, note.audioLengthSec ? `使用 ${formatSec(note.audioLengthSec)}` : ""]
        .filter(Boolean)
        .join(" · ");
  } else {
    // 没有音乐时只能按图片时长合成
    document.querySelector('input[name="len"][value="images"]').checked = true;
    document.querySelector('input[name="len"][value="music"]').disabled = true;
    document.querySelector('input[name="per"][value="manual"]').checked = true;
  }

  const [ow, oh] = DNV.resolveSize(note.images, "original");
  $("sizeOriginal").textContent = `原图尺寸（${ow} × ${oh}）`;
  if (note.music && note.audioLengthSec) {
    $("autoHint").textContent = `（${(note.audioLengthSec / note.images.length).toFixed(1)} 秒/张）`;
  } else {
    $("autoHint").textContent = "（3 秒/张）";
  }

  for (const el of document.querySelectorAll("input, select")) {
    el.addEventListener("change", updateSummary);
    el.addEventListener("input", updateSummary);
  }
  updateSummary();
}

// ---------- 下载素材 ----------

async function downloadAssets() {
  if (busy) return;
  setBusy(true);
  const dir = `抖音图文/${baseName()}`;
  const total = note.images.length + (note.music ? 1 : 0) + note.liveCount;
  let done = 0;
  try {
    for (const im of note.images) {
      setProgress(done / total, `正在下载第 ${im.index} / ${note.images.length} 张图片…`);
      const f = await fetchAny(im.urls, `第 ${im.index} 张图片`);
      await saveBlob(new Blob([f.bytes], { type: f.mime }), `${dir}/${String(im.index).padStart(2, "0")}.${f.ext}`);
      done++;
      if (im.liveUrls.length) {
        setProgress(done / total, `正在下载第 ${im.index} 张的实况视频…`);
        const v = await fetchAny(im.liveUrls, `第 ${im.index} 张实况视频`);
        await saveBlob(new Blob([v.bytes], { type: v.mime }), `${dir}/${String(im.index).padStart(2, "0")}_live.${v.ext}`);
        done++;
      }
    }
    if (note.music) {
      setProgress(done / total, "正在下载背景音乐…");
      const a = await fetchAny(note.music.urls, "背景音乐");
      const name = DNV.safeFileName(note.music.title || "music", 40);
      await saveBlob(new Blob([a.bytes], { type: a.mime }), `${dir}/${name}.${a.ext}`);
      done++;
    }
    const text = [
      note.author ? `作者：@${note.author}` : "",
      `链接：${note.pageUrl}`,
      note.music ? `音乐：${note.music.title}${note.music.author ? " - " + note.music.author : ""}` : "",
      "",
      note.desc
    ]
      .filter((x, i) => x || i === 3)
      .join("\n");
    await saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${dir}/文案.txt`);
    setProgress(1, `已保存到下载文件夹的「${dir}」`);
  } catch (e) {
    setProgress(null, e.message, true);
  } finally {
    setBusy(false);
  }
}

// ---------- 合成视频 ----------

// 用浏览器把图片等比缩放、补黑边到统一尺寸，输出 JPEG。
// 不用 ffmpeg.wasm 做这一步：它的 mjpeg 编码器遇到细节丰富的大图会
// 抛出 "memory access out of bounds"；而且尺寸不一致直接 concat 会丢图。
async function fitImage(bytes, mime, [w, h]) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / bmp.width, h / bmp.height);
    const dw = Math.round(bmp.width * scale);
    const dh = Math.round(bmp.height * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, Math.floor((w - dw) / 2), Math.floor((h - dh) / 2), dw, dh);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bmp.close();
  }
}

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  setProgress(0.02, "正在加载 ffmpeg.wasm（首次约需数秒）…");
  const ff = new FFmpeg();
  ff.on("log", ({ message }) => {
    log(message);
    onFFmpegLog(message);
  });
  await ff.load({
    coreURL: chrome.runtime.getURL("vendor/ffmpeg-core/ffmpeg-core.js"),
    wasmURL: chrome.runtime.getURL("vendor/ffmpeg-core/ffmpeg-core.wasm")
  });
  ffmpeg = ff;
  return ff;
}

let encodeTotal = 0;
let encodeStart = 0;
function onFFmpegLog(msg) {
  if (!encodeTotal) return;
  const m = msg.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return;
  const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const ratio = Math.min(1, t / encodeTotal);
  const elapsed = (performance.now() - encodeStart) / 1000;
  let eta = "";
  if (ratio > 0.03) eta = `，预计还需 ${formatSec((elapsed / ratio) * (1 - ratio))}`;
  setProgress(0.3 + ratio * 0.68, `正在合成视频 ${Math.round(ratio * 100)}%${eta}`);
}

async function compose() {
  if (busy) return;
  setBusy(true);
  $("result").hidden = true;
  const written = [];
  try {
    const opts = readOptions();
    const ff = await loadFFmpeg();

    // 1. 下载素材，并把每张图统一缩放到输出尺寸
    const size = DNV.resolveSize(note.images, opts.sizePreset);
    const imageFiles = [];
    for (const im of note.images) {
      setProgress(0.05 + (0.2 * (im.index - 1)) / note.images.length, `正在准备第 ${im.index} / ${note.images.length} 张图片…`);
      const f = await fetchAny(im.urls, `第 ${im.index} 张图片`);
      const out = `img${String(im.index).padStart(3, "0")}.jpg`;
      let fitted;
      try {
        fitted = await fitImage(f.bytes, f.mime, size);
      } catch (e) {
        throw new Error(`第 ${im.index} 张图片无法解码（${f.mime}）：${e.message}`);
      }
      await ff.writeFile(out, fitted);
      written.push(out);
      imageFiles.push(out);
    }
    let audioFile = null;
    if (note.music) {
      setProgress(0.27, "正在下载背景音乐…");
      const a = await fetchAny(note.music.urls, "背景音乐");
      audioFile = `music.${a.ext === "bin" ? "mp3" : a.ext}`;
      await ff.writeFile(audioFile, a.bytes.slice());
      written.push(audioFile);
    }

    // 2. 生成参数
    const plan = DNV.buildComposePlan({
      imageFiles,
      audioFile,
      audioStartSec: note.audioStartSec,
      audioLengthSec: note.audioLengthSec,
      perImage: opts.perImage,
      lengthMode: opts.lengthMode,
      size,
      fps: opts.fps,
      crf: opts.crf
    });
    await ff.writeFile("list.txt", plan.concat);
    written.push("list.txt");
    log("$ ffmpeg " + plan.args.join(" "));

    // 3. 编码
    encodeTotal = plan.totalSec;
    encodeStart = performance.now();
    setProgress(0.3, "正在合成视频…");
    const code = await ff.exec(plan.args);
    encodeTotal = 0;
    if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}，详情见下方日志`);

    const data = await ff.readFile("output.mp4");
    written.push("output.mp4");
    const blob = new Blob([data], { type: "video/mp4" });
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);

    $("video").src = outputUrl;
    $("result").hidden = false;
    const secs = ((performance.now() - encodeStart) / 1000).toFixed(0);
    $("resultInfo").textContent = `${formatSec(plan.totalSec)} · ${formatBytes(blob.size)} · 用时 ${secs} 秒`;
    $("save").onclick = () => saveBlob(blob, `抖音图文/${baseName()}.mp4`);
    setProgress(1, "合成完成");
  } catch (e) {
    encodeTotal = 0;
    console.error(e);
    let msg = (e && e.message) || String(e);
    // WebAssembly 崩溃后这个 ffmpeg 实例就不能再用了，丢掉，下次重新加载
    if (/RuntimeError|memory access|unreachable|abort/i.test(msg) && ffmpeg) {
      ffmpeg.terminate();
      ffmpeg = null;
      msg += "（ffmpeg 已重置，可调小画面尺寸或帧率后重试；仍失败请附上下方日志提 Issue）";
    }
    setProgress(null, msg, true);
  } finally {
    if (ffmpeg) {
      for (const f of written) {
        try {
          await ffmpeg.deleteFile(f);
        } catch (e) {}
      }
    }
    setBusy(false);
  }
}

// ---------- 启动 ----------

(async () => {
  if (!noteId) return fatal("缺少作品 ID。请在抖音图文页面点击插件图标打开。");
  const key = `note:${noteId}`;
  const got = await chrome.storage.session.get(key);
  note = got[key];
  if (!note) return fatal("找不到作品数据（浏览器重启后会清空）。请回到抖音页面重新点击插件图标。");
  render();
  $("compose").addEventListener("click", compose);
  $("download").addEventListener("click", downloadAssets);
  if (params.get("action") === "download") downloadAssets();
})();
