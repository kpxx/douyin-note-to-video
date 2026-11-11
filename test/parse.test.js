const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const DNV = require("../extension/lib/parse.js");

const html = fs.readFileSync(path.join(__dirname, "fixtures/note-page.html"), "utf8");
const apiFeed = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/api-feed.json"), "utf8"));
const NOTE_ID = "7654463310411066809";

test("从各种页面地址取出作品 ID", () => {
  assert.equal(DNV.extractAwemeId(`https://www.douyin.com/note/${NOTE_ID}`), NOTE_ID);
  assert.equal(DNV.extractAwemeId(`https://www.douyin.com/video/${NOTE_ID}?previous_page=x`), NOTE_ID);
  assert.equal(DNV.extractAwemeId(`https://www.douyin.com/jingxuan?modal_id=${NOTE_ID}`), NOTE_ID);
  assert.equal(DNV.extractAwemeId(`https://www.douyin.com/user/MS4wLj?modal_id=${NOTE_ID}`), NOTE_ID);
  assert.equal(DNV.extractAwemeId("https://www.douyin.com/"), null);
  assert.equal(DNV.extractAwemeId("not a url"), null);
});

test("从 SSR 页面解析出作品（数据被切成多个 __pace_f 片段）", () => {
  const chunks = DNV.parsePaceChunksFromHtml(html);
  assert.equal(chunks.length, 3);
  const raw = DNV.findAwemeInHtml(html, NOTE_ID);
  assert.ok(raw);
  assert.equal(raw.awemeId, NOTE_ID);
  assert.equal(raw.images.length, 3);
});

test("按 ID 精确匹配，不会误拿页面里的其他作品", () => {
  const other = DNV.findAwemeInHtml(html, "7600000000000000001");
  assert.equal(other.awemeType, 0);
  assert.equal(DNV.normalizeAweme(other).images.length, 0);
  assert.equal(DNV.findAwemeInHtml(html, "1234567890123"), null);
  // 不指定 ID 时取第一个带图片的作品
  assert.equal(DNV.findAwemeInHtml(html).awemeId, NOTE_ID);
});

test("字符串里的括号不影响 JSON 截取", () => {
  const t = 'x"detail":{"a":"}{\\"}","b":{"c":1}} tail';
  const start = t.indexOf("{");
  assert.equal(DNV.sliceBalanced(t, start), '{"a":"}{\\"}","b":{"c":1}}');
});

test("规整 SSR 数据：无水印 jpeg 优先、音乐区间、实况照片", () => {
  const note = DNV.normalizeAweme(DNV.findAwemeInHtml(html, NOTE_ID));
  assert.equal(note.id, NOTE_ID);
  assert.equal(note.type, 68);
  assert.equal(note.author, "三千千");
  assert.equal(note.images.length, 3);

  // 第 1 张：列表里有 webp 和 jpeg，jpeg 排第一
  assert.match(note.images[0].urls[0], /\.jpeg\?/);
  // 永远不使用 downloadUrlList 里带水印的地址
  for (const im of note.images) {
    for (const u of im.urls) assert.ok(!DNV.isWatermarked(u), u);
  }
  // 第 3 张只有 webp 也能用
  assert.match(note.images[2].urls[0], /\.webp\?/);

  assert.equal(note.music.title, "Starlight(氛围beat)");
  assert.equal(note.music.urls.length, 2);
  assert.equal(note.audioStartSec, 0);
  assert.equal(note.audioLengthSec, 111);

  assert.equal(note.liveCount, 1);
  assert.match(note.images[2].liveUrls[0], /douyinvod\.com/);
});

test("规整接口数据（snake_case）", () => {
  const list = DNV.collectAwemesFromJson(apiFeed);
  assert.equal(list.length, 1, "只收集带图片的作品");
  const note = DNV.normalizeAweme(list[0]);
  assert.equal(note.id, "7700000000000000002");
  assert.equal(note.author, "某用户");
  assert.match(note.images[0].urls[0], /\.jpeg/);
  assert.equal(note.images[0].liveUrls.length, 1);
  assert.equal(note.audioStartSec, 5);
  assert.equal(note.audioLengthSec, 15);
});

test("没有 imageAlbumMusicInfo 时用音乐时长", () => {
  const note = DNV.normalizeAweme({
    aweme_id: "1",
    images: [{ url_list: ["https://a/b.jpeg"] }],
    music: { duration: 42, play_url: { url_list: ["https://a/m.mp3"] } },
    image_album_music_info: "$undefined"
  });
  assert.equal(note.audioLengthSec, 42);
});

test("文件名清理", () => {
  assert.equal(DNV.safeFileName('a/b:c*?"<>| #话题 #另一个'), "a b c");
  assert.equal(DNV.safeFileName(""), "douyin");
  assert.equal(DNV.safeFileName("一二三四五六七八九十", 4), "一二三四");
});
