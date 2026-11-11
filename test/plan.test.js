const test = require("node:test");
const assert = require("node:assert/strict");
const DNV = require("../extension/lib/parse.js");

const files = Array.from({ length: 11 }, (_, i) => `img${String(i + 1).padStart(3, "0")}.jpg`);
const base = {
  imageFiles: files,
  audioFile: "music.mp3",
  audioStartSec: 0,
  audioLengthSec: 111,
  perImage: "auto",
  lengthMode: "music",
  size: [1242, 1660],
  fps: 15,
  crf: 21
};

function durations(concat) {
  return [...concat.matchAll(/^duration (\S+)$/gm)].map((m) => Number(m[1]));
}

test("自动模式：音乐时长平均分给每张图片", () => {
  const plan = DNV.buildComposePlan(base);
  assert.equal(plan.entries, 11);
  assert.ok(Math.abs(plan.perImage - 111 / 11) < 1e-9);
  assert.equal(plan.totalSec, 111);
  const d = durations(plan.concat);
  assert.equal(d.length, 11);
  assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 111) < 0.01);
});

test("concat 列表最后一张重复一次", () => {
  const plan = DNV.buildComposePlan(base);
  const lines = plan.concat.trim().split("\n");
  assert.equal(lines[0], "ffconcat version 1.0");
  assert.equal(lines.at(-1), "file 'img011.jpg'");
});

test("手动 3 秒 + 跟随音乐：图片循环直到音乐结束", () => {
  const plan = DNV.buildComposePlan({ ...base, perImage: 3 });
  assert.equal(plan.totalSec, 111);
  assert.equal(plan.entries, 37);
  const d = durations(plan.concat);
  assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 111) < 0.01);
  assert.match(plan.concat, /file 'img001.jpg'[\s\S]*file 'img011.jpg'[\s\S]*file 'img001.jpg'/);
});

test("手动 2 秒 + 图片播完即结束", () => {
  const plan = DNV.buildComposePlan({ ...base, perImage: 2, lengthMode: "images" });
  assert.equal(plan.totalSec, 22);
  assert.equal(plan.entries, 11);
  const t = plan.args[plan.args.indexOf("-t") + 1];
  assert.equal(t, "22");
});

test("ffmpeg 参数：缩放补边、音乐起点、编码器", () => {
  const plan = DNV.buildComposePlan({ ...base, audioStartSec: 5, audioLengthSec: 30 });
  const a = plan.args;
  const vf = a[a.indexOf("-vf") + 1];
  assert.match(vf, /scale=1242:1660:force_original_aspect_ratio=decrease/);
  assert.match(vf, /pad=1242:1660/);
  assert.match(vf, /fps=15/);
  // -ss 必须放在音乐输入之前
  assert.equal(a[a.indexOf("-ss") + 2], "-i");
  assert.equal(a[a.indexOf("-ss") + 3], "music.mp3");
  assert.ok(a.includes("libx264"));
  assert.ok(a.includes("aac"));
  assert.equal(a.at(-1), "output.mp4");
});

test("没有音乐时不加音频参数", () => {
  const plan = DNV.buildComposePlan({ ...base, audioFile: null, perImage: "auto" });
  assert.equal(plan.perImage, 3);
  assert.equal(plan.totalSec, 33);
  assert.ok(!plan.args.includes("aac"));
  assert.ok(!plan.args.includes("1:a:0"));
});

test("输出尺寸", () => {
  const imgs = [
    { width: 1242, height: 1660 },
    { width: 1086, height: 1448 }
  ];
  assert.deepEqual(DNV.resolveSize(imgs, "original"), [1242, 1660]);
  assert.deepEqual(DNV.resolveSize(imgs, "1080x1920"), [1080, 1920]);
  // 超大图限制长边 2160 且保持偶数
  const [w, h] = DNV.resolveSize([{ width: 3001, height: 4001 }], "original");
  assert.ok(Math.max(w, h) <= 2162 && w % 2 === 0 && h % 2 === 0);
  assert.deepEqual(DNV.resolveSize([], "original"), [1080, 1920]);
});

