// 抖音图文作品数据解析（页面脚本、弹窗、工作台、单元测试共用）
// 同时兼容两种数据来源：
//   1. SSR 页面里的 self.__pace_f（React Flight，字段为 camelCase，如 urlList / playUrl）
//   2. 网页接口 /aweme/v1/web/... 的 JSON（字段为 snake_case，如 url_list / play_url）
(function (root) {
  "use strict";

  const UNDEF = "$undefined";

  // ---------- 作品 ID ----------

  // 从页面地址中取出作品 ID：/note/、/video/、/slides/、/gallery/ 或 ?modal_id=
  function extractAwemeId(url) {
    if (!url) return null;
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return null;
    }
    const modal = u.searchParams.get("modal_id");
    if (modal && /^\d{8,}$/.test(modal)) return modal;
    const m = u.pathname.match(/\/(?:note|video|slides|gallery)\/(\d{8,})/);
    return m ? m[1] : null;
  }

  // ---------- 从 SSR 页面中找出作品详情 ----------

  // 从 HTML 文本中取出所有 self.__pace_f.push([...]) 的参数
  function parsePaceChunksFromHtml(html) {
    const chunks = [];
    if (!html) return chunks;
    const re = /self\.__pace_f\.push\((\[[\s\S]*?\])\)\s*(?:;\s*)?<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      try {
        chunks.push(JSON.parse(m[1]));
      } catch (e) {
        /* 忽略非 JSON 的片段 */
      }
    }
    return chunks;
  }

  // 把 __pace_f 片段拼成完整的 Flight 文本（数据可能被切在多个片段里）
  function joinFlight(chunks) {
    let out = "";
    for (const c of chunks || []) {
      if (Array.isArray(c) && typeof c[1] === "string") out += c[1];
    }
    return out;
  }

  // 从 start（必须是 "{"）开始截取一个完整的 JSON 对象，正确处理字符串里的括号
  function sliceBalanced(text, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  // 在 Flight 文本里找作品详情对象（"detail":{...,"awemeId":"..."}）
  // 指定 awemeId 时只返回匹配的那一个；否则返回第一个带图片的
  function findAwemeInFlight(flight, awemeId) {
    if (!flight) return null;
    const re = /"detail":\{/g;
    let m;
    let fallback = null;
    while ((m = re.exec(flight))) {
      const raw = sliceBalanced(flight, m.index + m[0].length - 1);
      if (!raw) continue;
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        continue;
      }
      const id = obj && (obj.awemeId || obj.aweme_id);
      if (!id) continue;
      if (awemeId && String(id) === String(awemeId)) return obj;
      if (!fallback && hasImages(obj)) fallback = obj;
    }
    return awemeId ? null : fallback;
  }

  function findAwemeInHtml(html, awemeId) {
    return findAwemeInFlight(joinFlight(parsePaceChunksFromHtml(html)), awemeId);
  }

  // 在任意 JSON（接口返回）里递归找出带图片的作品
  function collectAwemesFromJson(json, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (!json || typeof json !== "object" || depth > 8) return out;
    if (Array.isArray(json)) {
      for (const item of json) collectAwemesFromJson(item, out, depth + 1);
      return out;
    }
    const id = json.aweme_id || json.awemeId;
    if (id && hasImages(json)) {
      out.push(json);
      return out;
    }
    for (const k in json) {
      const v = json[k];
      if (v && typeof v === "object") collectAwemesFromJson(v, out, depth + 1);
    }
    return out;
  }

  // ---------- 规整数据 ----------

  function val(v) {
    return v === UNDEF ? undefined : v;
  }

  function pick(obj, ...keys) {
    if (!obj) return undefined;
    for (const k of keys) {
      const v = val(obj[k]);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }

  function urlListOf(o) {
    if (!o) return [];
    if (Array.isArray(o)) {
      // SSR 里的 playAddr 是 [{src}]
      return o.map((x) => (typeof x === "string" ? x : x && x.src)).filter(Boolean);
    }
    const list = pick(o, "urlList", "url_list");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  }

  function hasImages(aweme) {
    const imgs = pick(aweme, "images");
    return Array.isArray(imgs) && imgs.length > 0;
  }

  // 是否为带水印的地址（downloadUrlList 里的那种）
  function isWatermarked(url) {
    return /tplv-dy-water|water-v2|watermark/i.test(url);
  }

  // 选出无水印的原图地址：优先 jpeg，其次 png / webp，绝不使用 downloadUrlList
  function pickImageUrls(image) {
    const list = urlListOf(image).filter((u) => !isWatermarked(u));
    const score = (u) => {
      const p = u.split("?")[0].toLowerCase();
      if (/\.jpe?g$/.test(p)) return 0;
      if (/\.png$/.test(p)) return 1;
      if (/\.webp$/.test(p)) return 2;
      return 3;
    };
    return list
      .map((u, i) => ({ u, i }))
      .sort((a, b) => score(a.u) - score(b.u) || a.i - b.i)
      .map((x) => x.u);
  }

  // 实况照片里的视频片段
  function liveVideoUrls(image) {
    const v = val(image && image.video);
    if (!v || typeof v !== "object") return [];
    const addr = pick(v, "playAddr", "play_addr", "play_addr_h264");
    const urls = urlListOf(addr);
    if (urls.length) return urls;
    const bitRate = pick(v, "bitRateList", "bit_rate");
    if (Array.isArray(bitRate) && bitRate.length) {
      return urlListOf(pick(bitRate[0], "playAddr", "play_addr"));
    }
    return [];
  }

  // 把各种来源的作品对象规整成统一结构
  function normalizeAweme(raw) {
    if (!raw) return null;
    const id = String(pick(raw, "awemeId", "aweme_id") || "");
    const imgs = pick(raw, "images") || [];
    const images = imgs.map((img, i) => {
      const urls = pickImageUrls(img);
      const live = liveVideoUrls(img);
      return {
        index: i + 1,
        width: Number(pick(img, "width")) || 0,
        height: Number(pick(img, "height")) || 0,
        urls,
        liveUrls: live
      };
    });

    const music = pick(raw, "music");
    const albumInfo = pick(raw, "imageAlbumMusicInfo", "image_album_music_info") || {};
    const beginMs = Number(pick(albumInfo, "beginTime", "begin_time")) || 0;
    const endMs = Number(pick(albumInfo, "endTime", "end_time")) || 0;
    const musicDurationSec = Number(pick(music, "duration")) || 0;

    let musicInfo = null;
    if (music) {
      const urls = urlListOf(pick(music, "playUrl", "play_url"));
      if (urls.length) {
        musicInfo = {
          title: pick(music, "title", "musicName") || "",
          author: pick(music, "author", "ownerNickname", "owner_nickname") || "",
          urls,
          durationSec: musicDurationSec
        };
      }
    }

    // 图文作品实际使用的音乐区间
    let startSec = beginMs > 0 ? beginMs / 1000 : 0;
    let lengthSec = 0;
    if (endMs > beginMs) lengthSec = (endMs - beginMs) / 1000;
    else if (musicDurationSec > 0) lengthSec = Math.max(0, musicDurationSec - startSec);

    const author = pick(raw, "authorInfo", "author") || {};
    return {
      id,
      type: Number(pick(raw, "awemeType", "aweme_type")) || 0,
      desc: String(pick(raw, "desc") || "").trim(),
      author: pick(author, "nickname") || "",
      images,
      music: musicInfo,
      audioStartSec: startSec,
      audioLengthSec: lengthSec,
      liveCount: images.filter((x) => x.liveUrls.length).length
    };
  }

  // ---------- 合成参数 ----------

  function even(n) {
    n = Math.max(2, Math.round(n));
    return n % 2 ? n + 1 : n;
  }

  // 计算输出尺寸
  function resolveSize(images, preset) {
    const presets = {
      "1080x1920": [1080, 1920],
      "720x1280": [720, 1280],
      "1080x1440": [1080, 1440],
      "1080x1080": [1080, 1080]
    };
    if (presets[preset]) return presets[preset];
    // 原图：取最大的宽和高，长边不超过 2160
    let w = 0;
    let h = 0;
    for (const im of images || []) {
      w = Math.max(w, im.width || 0);
      h = Math.max(h, im.height || 0);
    }
    if (!w || !h) return [1080, 1920];
    const scale = Math.min(1, 2160 / Math.max(w, h));
    return [even(w * scale), even(h * scale)];
  }

  function fmt(n) {
    return String(Math.round(n * 1000) / 1000);
  }

  function fitFilter(w, h) {
    return (
      `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
    );
  }

  /**
   * 生成合成计划
   * @param {object} o
   * @param {string[]} o.imageFiles   虚拟文件系统里的图片文件名（按顺序）
   * @param {string|null} o.audioFile 音乐文件名
   * @param {number} o.audioStartSec  音乐起点
   * @param {number} o.audioLengthSec 音乐可用长度（0 = 未知）
   * @param {"auto"|number} o.perImage 每张秒数，auto = 音乐长度 ÷ 张数
   * @param {"music"|"images"} o.lengthMode 视频长度跟随音乐，或图片放完即结束
   * @param {number[]} o.size  [宽, 高]
   * @param {number} o.fps
   * @param {number} o.crf
   */
  function buildComposePlan(o) {
    const n = o.imageFiles.length;
    if (!n) throw new Error("没有图片");
    const hasAudio = !!o.audioFile;
    const audioLen = hasAudio && o.audioLengthSec > 0 ? o.audioLengthSec : 0;

    let per;
    if (o.perImage === "auto" || !(Number(o.perImage) > 0)) {
      per = audioLen > 0 ? audioLen / n : 3;
    } else {
      per = Number(o.perImage);
    }
    per = Math.max(0.5, per);

    let total;
    if (o.lengthMode === "music" && audioLen > 0) total = audioLen;
    else total = per * n;

    // 按顺序排列图片，跟随音乐时循环播放直到填满
    const entries = [];
    let t = 0;
    let i = 0;
    while (t < total - 1e-6 && entries.length < 2000) {
      const d = Math.min(per, total - t);
      entries.push({ file: o.imageFiles[i % n], duration: d });
      t += d;
      i++;
    }

    let concat = "ffconcat version 1.0\n";
    for (const e of entries) {
      concat += `file '${e.file}'\nduration ${fmt(e.duration)}\n`;
    }
    // concat demuxer 的已知行为：最后一张需要再写一次，时长才会生效
    concat += `file '${entries[entries.length - 1].file}'\n`;

    const [w, h] = o.size;
    const fps = o.fps || 30;
    // 图片已经在浏览器里统一过尺寸（studio.js 的 fitImage），这里的缩放只是保险
    const vf = `${fitFilter(w, h)},fps=${fps},format=yuv420p`;

    const args = ["-hide_banner", "-f", "concat", "-safe", "0", "-i", "list.txt"];
    if (hasAudio) {
      if (o.audioStartSec > 0) args.push("-ss", fmt(o.audioStartSec));
      args.push("-i", o.audioFile);
    }
    args.push("-vf", vf, "-map", "0:v:0");
    if (hasAudio) args.push("-map", "1:a:0");
    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "stillimage",
      "-crf", String(o.crf || 20),
      "-pix_fmt", "yuv420p",
      "-r", String(fps)
    );
    if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k");
    args.push("-t", fmt(total), "-movflags", "+faststart", "-y", "output.mp4");

    return { concat, args, perImage: per, totalSec: total, entries: entries.length };
  }

  // 文件名清理（Windows / macOS 都安全）
  function safeFileName(s, max) {
    max = max || 40;
    const clean = String(s || "")
      .replace(/#\S+/g, "")
      .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return Array.from(clean).slice(0, max).join("").trim().replace(/[. ]+$/, "") || "douyin";
  }

  const api = {
    extractAwemeId,
    parsePaceChunksFromHtml,
    joinFlight,
    sliceBalanced,
    findAwemeInFlight,
    findAwemeInHtml,
    collectAwemesFromJson,
    normalizeAweme,
    pickImageUrls,
    isWatermarked,
    resolveSize,
    buildComposePlan,
    safeFileName
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DNV = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
