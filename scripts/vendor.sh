#!/usr/bin/env bash
# 把 ffmpeg.wasm 从 node_modules 复制到 extension/vendor/
# Chrome MV3 禁止加载远程代码，所以 ffmpeg.wasm 必须打包在插件内部。
# 用法：npm install && npm run vendor
set -euo pipefail

cd "$(dirname "$0")/.."
FF=node_modules/@ffmpeg/ffmpeg
CORE=node_modules/@ffmpeg/core
if [ ! -d "$FF" ] || [ ! -d "$CORE" ]; then
  echo "请先运行 npm install" >&2
  exit 1
fi

rm -rf extension/vendor/ffmpeg extension/vendor/ffmpeg-core
mkdir -p extension/vendor/ffmpeg extension/vendor/ffmpeg-core

# @ffmpeg/ffmpeg（MIT）：ESM 版本，worker 以 module 方式加载 core
for f in index.js classes.js const.js errors.js types.js utils.js worker.js; do
  cp "$FF/dist/esm/$f" extension/vendor/ffmpeg/
done

# @ffmpeg/core（GPL-2.0-or-later）：单线程版本，不需要 SharedArrayBuffer / 跨源隔离
cp "$CORE/dist/esm/ffmpeg-core.js" "$CORE/dist/esm/ffmpeg-core.wasm" extension/vendor/ffmpeg-core/

FFV=$(node -p "require('./$FF/package.json').version")
COREV=$(node -p "require('./$CORE/package.json').version")
cat > extension/vendor/README.md <<MD
# 第三方组件 / Third-party components

| 目录 | 来源 | 版本 | 许可证 |
| --- | --- | --- | --- |
| \`ffmpeg/\` | [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) | ${FFV} | MIT |
| \`ffmpeg-core/\` | [@ffmpeg/core](https://github.com/ffmpegwasm/ffmpeg.wasm)（FFmpeg + x264 等编译为 WebAssembly） | ${COREV} | GPL-2.0-or-later |

由 \`npm run vendor\` 从 npm 包原样复制，请勿手动修改。
Copied verbatim from npm by \`npm run vendor\`. Do not edit by hand.

FFmpeg 源码 / FFmpeg source: https://ffmpeg.org/ · ffmpeg.wasm 构建脚本 / build scripts: https://github.com/ffmpegwasm/ffmpeg.wasm
MD

echo "Vendored @ffmpeg/ffmpeg@${FFV} and @ffmpeg/core@${COREV}"
